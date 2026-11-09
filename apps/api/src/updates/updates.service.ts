import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { SessionUser } from "../auth/auth.middleware.js";
import type { AiQueue } from "../ai/queue.js";
import { fromIso, toIso, type Clock } from "../lib/dates.js";
import { isoDate } from "../lib/validate.js";
import { loadHolidays } from "../orders/orderRisk.js";
import { addDays } from "../risk/calendar.js";
import { isStoredFileUrl } from "../uploads/storage.js";
import { previousWorkingDay, stagesMissedOn } from "./missedDay.js";

/** How late an offline update may still arrive. Assumption, labelled in the TDD. */
const MAX_AGE_DAYS = 30;

const storedFile = z.string().refine(isStoredFileUrl, "Must be a file from the upload endpoint");

export const updateItemSchema = z.object({
  id: z.uuid(),
  milestoneId: z.uuid(),
  workDate: isoDate,
  qty: z.number().int().min(0).max(1_000_000),
  noteText: z.string().trim().max(1000).optional(),
  photoUrl: storedFile.optional(),
  voiceUrl: storedFile.optional(),
  capturedAt: z.iso.datetime(),
  /** The work day the phone was on when this was typed. Phones from before this existed leave it out. */
  enteredOn: isoDate.optional(),
});

export const syncBodySchema = z.object({
  updates: z.array(z.unknown()).min(1).max(50),
});

export type UpdateItem = z.infer<typeof updateItemSchema>;

export type RejectCode =
  | "INVALID"
  | "NOT_FOUND"
  | "WRONG_UNIT"
  | "NOT_QUANTITY_STAGE"
  | "FUTURE_DATE"
  | "TOO_OLD"
  | "TOO_LATE"
  | "OVER_QUANTITY"
  | "AHEAD_OF_PREVIOUS"
  | "BELOW_NEXT"
  | "ID_CONFLICT";

export type SyncResult =
  /** Stored and counted. */
  | { id: string; status: "ACCEPTED"; doneQty: number; plannedQty: number }
  /** A retry of an update already stored. Safe for the phone to clear. */
  | { id: string; status: "DUPLICATE" }
  /** Arrived after a newer figure for that day, so it is kept as history and not counted. */
  | { id: string; status: "STALE" }
  /** Needs the supervisor's attention. The phone keeps it and shows why. */
  | { id: string | null; status: "REJECTED"; code: RejectCode; message: string };

class Rejection extends Error {
  constructor(
    readonly code: RejectCode,
    message: string,
  ) {
    super(message);
  }
}

export function createUpdatesService(prisma: PrismaClient, today: Clock, aiQueue: AiQueue) {
  async function save(item: UpdateItem, user: SessionUser) {
    const now = today();
    // Judged against the day it was typed, not the day it arrived, so a phone offline for days
    // still delivers its queue. Without the field, an update counts as typed on its own work day.
    const enteredOn = item.enteredOn ?? item.workDate;
    if (item.workDate > now || enteredOn > now || item.workDate > enteredOn) {
      throw new Rejection("FUTURE_DATE", "The work date is in the future");
    }
    if (item.workDate < addDays(now, -MAX_AGE_DAYS)) {
      throw new Rejection("TOO_OLD", `Updates older than ${MAX_AGE_DAYS} days cannot be added`);
    }
    const holidaysFor = item.workDate < enteredOn ? await loadHolidays(prisma) : null;

    return prisma.$transaction(async (tx) => {
      // Locks every stage of the order, always in id order so two writers never deadlock. A count is
      // checked against its neighbouring stages, so they must not change while it is being saved.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Milestone"
        WHERE "orderId" = (SELECT "orderId" FROM "Milestone" WHERE id = ${item.milestoneId})
        ORDER BY id FOR UPDATE`;
      if (!locked.some((row) => row.id === item.milestoneId)) {
        throw new Rejection("NOT_FOUND", "This stage no longer exists");
      }

      const existing = await tx.dailyUpdate.findUnique({ where: { id: item.id } });
      if (existing) {
        if (existing.supervisorId !== user.id || existing.milestoneId !== item.milestoneId) {
          throw new Rejection("ID_CONFLICT", "This update id belongs to another update");
        }
        return { result: { id: item.id, status: "DUPLICATE" } as const };
      }

      const milestone = await tx.milestone.findUniqueOrThrow({ where: { id: item.milestoneId } });
      if (milestone.unitId !== user.unitId) {
        throw new Rejection("WRONG_UNIT", "This stage belongs to another unit");
      }
      if (milestone.plannedQty === null) {
        throw new Rejection("NOT_QUANTITY_STAGE", "This stage has no piece count");
      }
      if (holidaysFor && item.workDate < previousWorkingDay(enteredOn, holidaysFor(milestone.unitId))) {
        throw new Rejection("TOO_LATE", "Only the last working day's count can be added late");
      }

      const workDate = fromIso(item.workDate);
      const capturedAt = new Date(item.capturedAt);
      const current = await tx.dailyUpdate.findFirst({
        where: { milestoneId: milestone.id, workDate, supervisorId: user.id, supersededAt: null },
      });

      const record = {
        id: item.id,
        milestoneId: milestone.id,
        supervisorId: user.id,
        workDate,
        qty: item.qty,
        noteText: item.noteText || null,
        photoUrl: item.photoUrl,
        voiceUrl: item.voiceUrl,
        capturedAt,
        enteredOn: item.enteredOn ? fromIso(item.enteredOn) : null,
      };

      if (current && current.capturedAt > capturedAt) {
        await tx.dailyUpdate.create({ data: { ...record, supersededAt: new Date() } });
        return { result: { id: item.id, status: "STALE" } as const };
      }

      const doneQty = milestone.doneQty - (current?.qty ?? 0) + item.qty;
      if (doneQty > milestone.plannedQty) {
        const room = milestone.plannedQty - milestone.doneQty + (current?.qty ?? 0);
        throw new Rejection(
          "OVER_QUANTITY",
          `This would exceed the planned ${milestone.plannedQty} pieces. At most ${room} can be entered`,
        );
      }

      // A stage cannot pass the stage before it: nothing is stitched that was never cut.
      const counted = await tx.milestone.findMany({
        where: { orderId: milestone.orderId, plannedQty: { not: null } },
        orderBy: { sequence: "asc" },
      });
      const position = counted.findIndex((stage) => stage.id === milestone.id);
      const previous = counted[position - 1];
      const next = counted[position + 1];
      if (previous && doneQty > previous.doneQty) {
        throw new Rejection(
          "AHEAD_OF_PREVIOUS",
          `Only ${previous.doneQty} pieces have finished ${stageWord(previous.stage)} so far, so this stage cannot have more`,
        );
      }
      if (next && doneQty < next.doneQty) {
        throw new Rejection(
          "BELOW_NEXT",
          `${next.doneQty} pieces have already reached ${stageWord(next.stage)}, so this stage cannot have fewer`,
        );
      }

      if (current) {
        await tx.dailyUpdate.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
      }
      const issue = buildIssue(item);
      await tx.dailyUpdate.create({ data: { ...record, issue: issue && { create: issue } } });
      await tx.milestone.update({
        where: { id: milestone.id },
        data: {
          doneQty,
          completedAt: doneQty === milestone.plannedQty ? workDate : null,
        },
      });

      const created = issue
        ? await tx.issue.findUnique({ where: { dailyUpdateId: item.id }, select: { id: true, aiStatus: true } })
        : null;

      return {
        result: { id: item.id, status: "ACCEPTED", doneQty, plannedQty: milestone.plannedQty } as const,
        issueToClassify: created?.aiStatus === "PENDING" ? created.id : undefined,
      };
    });
  }

  /** Each update stands alone: one bad entry never blocks the rest of a phone's queue. */
  async function sync(items: readonly unknown[], user: SessionUser): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const raw of items) {
      const parsed = updateItemSchema.safeParse(raw);
      if (!parsed.success) {
        const rawId = z.object({ id: z.string() }).safeParse(raw);
        results.push({
          id: rawId.success ? rawId.data.id : null,
          status: "REJECTED",
          code: "INVALID",
          message: "This update has invalid fields",
        });
        continue;
      }
      results.push(await syncOne(parsed.data, user));
    }
    return results;
  }

  async function syncOne(item: UpdateItem, user: SessionUser): Promise<SyncResult> {
    try {
      const saved = await save(item, user);
      // After the commit, and not awaited: a slow or failing AI never holds up a floor update.
      if ("issueToClassify" in saved && saved.issueToClassify) aiQueue.schedule(saved.issueToClassify);
      return saved.result;
    } catch (error) {
      if (error instanceof Rejection) {
        return { id: item.id, status: "REJECTED", code: error.code, message: error.message };
      }
      // The same id on a different stage gets past the row lock and fails on the primary key.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return {
          id: item.id,
          status: "REJECTED",
          code: "ID_CONFLICT",
          message: "This update id belongs to another update",
        };
      }
      throw error;
    }
  }

  /** The supervisor's screen: unfinished stages at their unit, most urgent first. */
  async function worklist(user: SessionUser) {
    const now = today();
    if (!user.unitId) return { today: now, stages: [] };
    const holidays = (await loadHolidays(prisma))(user.unitId);
    const missedDate = previousWorkingDay(now, holidays);
    const missed = new Set((await stagesMissedOn(prisma, missedDate, user.unitId)).map((stage) => stage.milestoneId));
    const milestones = await prisma.milestone.findMany({
      where: {
        unitId: user.unitId,
        plannedQty: { not: null },
        completedAt: null,
        order: { milestones: { none: { stage: "EX_FACTORY", completedAt: { not: null } } } },
      },
      orderBy: { plannedDate: "asc" },
      include: {
        order: {
          select: {
            poNumber: true,
            style: true,
            colour: true,
            milestones: { where: { plannedQty: { not: null } }, select: { sequence: true, doneQty: true } },
          },
        },
        updates: {
          where: { supersededAt: null, supervisorId: user.id, workDate: fromIso(now) },
          select: { qty: true },
        },
      },
    });
    return {
      today: now,
      stages: milestones.map((milestone) => ({
        milestoneId: milestone.id,
        stage: milestone.stage,
        poNumber: milestone.order.poNumber,
        style: milestone.order.style,
        colour: milestone.order.colour,
        plannedQty: milestone.plannedQty,
        doneQty: milestone.doneQty,
        /** The most this stage can reach for now: what the stage before it has finished. */
        capQty:
          milestone.order.milestones
            .filter((other) => other.sequence < milestone.sequence)
            .sort((a, b) => b.sequence - a.sequence)[0]?.doneQty ?? milestone.plannedQty,
        plannedDate: toIso(milestone.plannedDate),
        todayQty: milestone.updates[0]?.qty ?? null,
        /** The last working day, when this stage should have had a count then and did not. */
        missedDate: missed.has(milestone.id) ? missedDate : null,
      })),
    };
  }

  return { sync, worklist };
}

const stageWord = (stage: string): string => stage.toLowerCase().replace("_", " ");

/**
 * A typed note goes to the AI. So does a voice note: the queue writes down what was said first,
 * and when it cannot, the note goes to a person to listen to.
 */
function buildIssue(item: UpdateItem) {
  if (item.noteText) return { originalText: item.noteText };
  if (item.voiceUrl) return { originalText: "" };
  return undefined;
}
