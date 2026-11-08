/**
 * The decisions behind each notification, kept free of the database so they can be tested
 * on their own. Assumptions, labelled in the TDD: the reminder and escalation times, the
 * two-hour wait for notes, and which stages count as under way.
 */

/** India has no daylight saving, so a fixed offset is exact. */
const IST_OFFSET_MINUTES = 330;

/** Minutes since midnight in India for an instant. */
export function minutesInIndia(instant: Date): number {
  return (instant.getUTCHours() * 60 + instant.getUTCMinutes() + IST_OFFSET_MINUTES) % 1440;
}

/** "17:30" to minutes since midnight. */
export function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Not a time of day: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Not a time of day: ${value}`);
  return hours * 60 + minutes;
}

export const NOTE_WAIT_MS = 2 * 60 * 60 * 1000;

export interface StageRow {
  id: string;
  orderId: string;
  sequence: number;
  completed: boolean;
  doneQty: number;
  /** Whether anyone reported a figure for this stage on the date being checked. */
  reported: boolean;
}

/**
 * Stages that should have had a count on the date but did not. A stage is under way when it is
 * the first counted stage of its order, has pieces done, or follows a finished stage. A stage
 * that has not started yet is not missed: there is nothing on the floor to count.
 */
export function missedStages<T extends StageRow>(rows: readonly T[]): T[] {
  const byOrder = new Map<string, T[]>();
  for (const row of rows) byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row]);

  const missed: T[] = [];
  for (const stages of byOrder.values()) {
    const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
    ordered.forEach((stage, index) => {
      const previous = ordered[index - 1];
      const underWay = index === 0 || stage.doneQty > 0 || previous?.completed === true;
      if (underWay && !stage.completed && !stage.reported) missed.push(stage);
    });
  }
  return missed;
}
