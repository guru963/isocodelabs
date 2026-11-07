import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { SessionUser } from "../auth/auth.middleware.js";
import type { AiQueue } from "../ai/queue.js";
import { fromIso, toIso, type Clock } from "../lib/dates.js";
import { isoDate } from "../lib/validate.js";
import { addDays } from "../risk/calendar.js";
import { isStoredFileUrl } from "../uploads/storage.js";

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
  | "OVER_QUANTITY"
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
    if (item.workDate > now) throw new Rejection("FUTURE_DATE", "The work date is in the future");
    if (item.workDate < addDays(now, -MAX_AGE_DAYS)) {
      throw new Rejection("TOO_OLD", `Updates older than ${MAX_AGE_DAYS} days cannot be added`);
    }

    return prisma.$transaction(async (tx) => {
      // Serialises writers to one stage, so two phones syncing together both see the true total.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Milestone" WHERE id = ${item.milestoneId} FOR UPDATE`;
      if (locked.length === 0) throw new Rejection("NOT_FOUND", "This stage no longer exists");

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
    const milestones = await prisma.milestone.findMany({
      where: {
        unitId: user.unitId,
        plannedQty: { not: null },
        completedAt: null,
        order: { milestones: { none: { stage: "EX_FACTORY", completedAt: { not: null } } } },
      },
      orderBy: { plannedDate: "asc" },
      include: {
        order: { select: { poNumber: true, style: true, colour: true } },
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
        plannedDate: toIso(milestone.plannedDate),
        todayQty: milestone.updates[0]?.qty ?? null,
      })),
    };
  }

  return { sync, worklist };
}

/** A typed note goes to the AI. A voice note waits for a person until transcription exists. */
function buildIssue(item: UpdateItem) {
  if (item.noteText) return { originalText: item.noteText };
  if (item.voiceUrl) {
    return { originalText: "", aiStatus: "FAILED", aiError: "VOICE_NOT_TRANSCRIBED" } as const;
  }
  return undefined;
}
