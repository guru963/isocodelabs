import type { IsoDate } from "../risk/calendar.js";

export const fromIso = (date: IsoDate): Date => new Date(`${date}T00:00:00Z`);
export const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export type Clock = () => IsoDate;

/** Today in India. `fixedToday` pins it so the fixed sample dates stay meaningful in a demo. */
export function createClock(fixedToday?: IsoDate): Clock {
  if (fixedToday) return () => fixedToday;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  return () => format.format(new Date());
}
