/**
 * Calendar dates as "YYYY-MM-DD" strings. A factory deadline is a date, not an
 * instant, so strings keep a server in another timezone from shifting it a day.
 */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const SUNDAY = 0;

const toUtcMs = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** Assumption: the factory works Monday to Saturday, except listed holidays. */
export function isWorkingDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  return new Date(toUtcMs(date)).getUTCDay() !== SUNDAY && !holidays.has(date);
}

/** Working days after `after`, up to and including `through`. */
export function countWorkingDays(
  after: IsoDate,
  through: IsoDate,
  holidays: ReadonlySet<IsoDate>,
): number {
  let count = 0;
  for (let day = addDays(after, 1); day <= through; day = addDays(day, 1)) {
    if (isWorkingDay(day, holidays)) count += 1;
  }
  return count;
}

/** The date of the nth working day after `after`. */
export function addWorkingDays(
  after: IsoDate,
  count: number,
  holidays: ReadonlySet<IsoDate>,
): IsoDate {
  let day = after;
  for (let remaining = count; remaining > 0; ) {
    day = addDays(day, 1);
    if (isWorkingDay(day, holidays)) remaining -= 1;
  }
  return day;
}

/** `date` itself if it is a working day, otherwise the working day before it. */
export function workingDayOnOrBefore(date: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate {
  let day = date;
  while (!isWorkingDay(day, holidays)) day = addDays(day, -1);
  return day;
}
