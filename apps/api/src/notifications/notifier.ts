import { Prisma, type MessageChannel, type NotificationKind, type PrismaClient } from "@prisma/client";
import { fromIso, toIso, type Clock } from "../lib/dates.js";
import { isShipped, loadHolidays, orderWithProgress, riskOf } from "../orders/orderRisk.js";
import { addDays, isWorkingDay, workingDayOnOrBefore } from "../risk/calendar.js";
import { previousWorkingDay, stagesMissedOn } from "../updates/missedDay.js";
import { escalationMessage, missedCountMessage, missedDayMessage, noteWaitingMessage, orderRedMessage } from "./messages.js";
import { minutesInIndia, missedStages, NOTE_WAIT_MS } from "./rules.js";

const SWEEP_MS = 5 * 60 * 1000;

export interface NotifierOptions {
  today: Clock;
  /** The real time, for the time-of-day rules. Tests pass a fixed one. */
  now?: () => Date;
  /** Minutes after midnight in India. */
  reminderAt: number;
  escalateAt: number;
  log?: (message: string) => void;
}

export interface Notifier {
  /** Runs every rule once. Safe to call at any time: nothing is ever sent twice. */
  run(): Promise<{ created: number }>;
  start(): void;
  stop(): void;
}

interface Draft {
  userId: string;
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  link: string | null;
  /** WhatsApp and SMS are mocked: a MessageLog row records the exact text and recipient. */
  channels: MessageChannel[];
  recipient: string;
}

export function createNotifier(prisma: PrismaClient, options: NotifierOptions): Notifier {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.info(message));
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<{ created: number }> | null = null;

  /** One row per notification, with its mock messages in the same insert. False if it already exists. */
  async function deliver(draft: Draft): Promise<boolean> {
    try {
      await prisma.notification.create({
        data: {
          userId: draft.userId,
          kind: draft.kind,
          dedupeKey: draft.dedupeKey,
          title: draft.title,
          body: draft.body,
          link: draft.link,
          messages: {
            create: draft.channels.map((channel) => ({ channel, recipient: draft.recipient, body: `${draft.title}\n${draft.body}` })),
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
    for (const channel of draft.channels) log(`[mock ${channel.toLowerCase()}] to ${draft.recipient}: ${draft.title}`);
    return true;
  }

  /** Every counted stage of every unshipped order, marked with whether it was reported on `date`. */
  async function stagesOn(date: string, unitId?: string) {
    const milestones = await prisma.milestone.findMany({
      where: {
        plannedQty: { not: null },
        order: { milestones: { none: { stage: "EX_FACTORY", completedAt: { not: null } } } },
      },
      include: {
        unit: { select: { id: true, name: true } },
        order: { select: { id: true, poNumber: true, merchandiserId: true } },
        updates: { where: { supersededAt: null, workDate: fromIso(date) }, select: { id: true } },
      },
    });
    const rows = milestones.map((milestone) => ({
      id: milestone.id,
      orderId: milestone.orderId,
      sequence: milestone.sequence,
      completed: milestone.completedAt !== null,
      doneQty: milestone.doneQty,
      reported: milestone.updates.length > 0,
      stage: milestone.stage,
      unitId: milestone.unitId,
      unitName: milestone.unit.name,
      poNumber: milestone.order.poNumber,
      merchandiserId: milestone.order.merchandiserId,
    }));
    return missedStages(rows).filter((row) => !unitId || row.unitId === unitId);
  }

  /** After the reminder time: each supervisor hears about their own unit's stages with no count today. */
  async function remindSupervisors(today: string): Promise<number> {
    const holidaysFor = await loadHolidays(prisma);
    const supervisors = await prisma.user.findMany({ where: { role: "SUPERVISOR", unitId: { not: null } } });
    const missed = await stagesOn(today);
    let created = 0;
    for (const supervisor of supervisors) {
      if (!isWorkingDay(today, holidaysFor(supervisor.unitId!))) continue;
      const theirs = missed.filter((row) => row.unitId === supervisor.unitId);
      if (theirs.length === 0) continue;
      const message = missedCountMessage(supervisor.language, today, theirs);
      const sent = await deliver({
        userId: supervisor.id,
        kind: "MISSED_COUNT",
        dedupeKey: `missed:${supervisor.id}:${today}`,
        ...message,
        link: "/floor",
        channels: ["WHATSAPP"],
        recipient: supervisor.name,
      });
      if (sent) created += 1;
    }
    return created;
  }

  /**
   * The next morning: each supervisor hears about their own stages with no count on the last
   * working day, at the same time as the merchandiser, so the person who can fix it knows too.
   */
  async function remindAboutMissedDay(today: string): Promise<number> {
    const holidaysFor = await loadHolidays(prisma);
    const supervisors = await prisma.user.findMany({ where: { role: "SUPERVISOR", unitId: { not: null } } });
    let created = 0;
    for (const supervisor of supervisors) {
      const holidays = holidaysFor(supervisor.unitId!);
      if (!isWorkingDay(today, holidays)) continue;
      const date = previousWorkingDay(today, holidays);
      const missed = await stagesMissedOn(prisma, date, supervisor.unitId!);
      if (missed.length === 0) continue;
      const sent = await deliver({
        userId: supervisor.id,
        kind: "MISSED_YESTERDAY",
        dedupeKey: `missed-day:${supervisor.id}:${date}`,
        ...missedDayMessage(supervisor.language, date, missed),
        link: "/floor",
        channels: ["WHATSAPP"],
        recipient: supervisor.name,
      });
      if (sent) created += 1;
    }
    return created;
  }

  /** The next morning: the merchandiser hears about any count still missing from the last working day. */
  async function escalate(today: string): Promise<number> {
    const holidaysFor = await loadHolidays(prisma);
    const units = await prisma.unit.findMany({ select: { id: true } });
    const byMerchandiser = new Map<string, { date: string; lines: Awaited<ReturnType<typeof stagesOn>> }>();
    for (const unit of units) {
      const date = workingDayOnOrBefore(addDays(today, -1), holidaysFor(unit.id));
      for (const row of await stagesOn(date, unit.id)) {
        const entry = byMerchandiser.get(row.merchandiserId) ?? { date, lines: [] };
        entry.lines.push(row);
        byMerchandiser.set(row.merchandiserId, entry);
      }
    }
    let created = 0;
    for (const [merchandiserId, { date, lines }] of byMerchandiser) {
      const merchandiser = await prisma.user.findUnique({ where: { id: merchandiserId } });
      if (!merchandiser) continue;
      const message = escalationMessage(date, lines.map((row) => ({ stage: row.stage, poNumber: row.poNumber, unit: row.unitName })));
      const sent = await deliver({
        userId: merchandiserId,
        kind: "MISSED_COUNT_ESCALATION",
        dedupeKey: `escalate:${merchandiserId}:${today}`,
        ...message,
        link: lines.length === 1 ? `/orders/${lines[0]!.orderId}` : "/board",
        channels: ["WHATSAPP"],
        recipient: merchandiser.name,
      });
      if (sent) created += 1;
    }
    return created;
  }

  /** A note left unreviewed for two hours reminds the order's merchandiser, once. */
  async function notesWaiting(instant: Date): Promise<number> {
    const issues = await prisma.issue.findMany({
      where: { status: "PENDING", createdAt: { lte: new Date(instant.getTime() - NOTE_WAIT_MS) } },
      include: {
        dailyUpdate: { select: { milestone: { select: { stage: true, order: { select: { poNumber: true, merchandiserId: true } } } } } },
      },
    });
    let created = 0;
    for (const issue of issues) {
      const { stage, order } = issue.dailyUpdate.milestone;
      const sent = await deliver({
        userId: order.merchandiserId,
        kind: "NOTE_WAITING",
        dedupeKey: `note:${issue.id}`,
        ...noteWaitingMessage(stage, order.poNumber, issue.translatedText ?? issue.originalText),
        link: "/notes",
        channels: [],
        recipient: "",
      });
      if (sent) created += 1;
    }
    return created;
  }

  /** An order that turns red tells its merchandiser, once for each ex-factory date. */
  async function ordersRed(today: string): Promise<number> {
    const holidaysFor = await loadHolidays(prisma);
    const orders = await prisma.order.findMany({ include: { ...orderWithProgress, merchandiser: { select: { name: true } } } });
    let created = 0;
    for (const order of orders) {
      if (isShipped(order)) continue;
      const risk = riskOf(order, today, holidaysFor(order.unitId));
      if (risk.status !== "RED") continue;
      const exFactory = toIso(order.exFactoryDate);
      const sent = await deliver({
        userId: order.merchandiserId,
        kind: "ORDER_RED",
        dedupeKey: `red:${order.id}:${exFactory}`,
        ...orderRedMessage(order.poNumber, exFactory, risk.projectedExFactory, risk.exFactorySlipDays, risk.exFactoryOverdue),
        link: `/orders/${order.id}`,
        channels: ["WHATSAPP"],
        recipient: order.merchandiser.name,
      });
      if (sent) created += 1;
    }
    return created;
  }

  async function runOnce(): Promise<{ created: number }> {
    const today = options.today();
    const instant = now();
    const minutes = minutesInIndia(instant);
    let created = 0;
    created += await ordersRed(today);
    created += await notesWaiting(instant);
    if (minutes >= options.reminderAt) created += await remindSupervisors(today);
    if (minutes >= options.escalateAt) {
      created += await remindAboutMissedDay(today);
      created += await escalate(today);
    }
    return { created };
  }

  return {
    run() {
      // Overlapping sweeps would only race to the same unique keys, so they simply share one run.
      running ??= runOnce().finally(() => {
        running = null;
      });
      return running;
    },
    start() {
      const tick = () =>
        void this.run().catch((error: unknown) => console.error("Notification sweep failed", error));
      timer = setInterval(tick, SWEEP_MS);
      timer.unref();
      tick();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
