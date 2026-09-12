import { getZonedDateTime, localDateTimeToUtc } from "../shared/dates";

export type RecurrenceRule = "daily" | "weekly" | "monthly";

export function nextRecurringOccurrence(value: string, rule: RecurrenceRule, timeZone: string): string {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) throw new Error("Recurrence date is invalid");
  const local = getZonedDateTime(source, timeZone);
  const next = { ...local };
  if (rule === "daily") {
    next.day += 1;
  } else if (rule === "weekly") {
    next.day += 7;
  } else {
    next.month += 1;
    if (next.month > 12) {
      next.month = 1;
      next.year += 1;
    }
    next.day = Math.min(next.day, daysInMonth(next.year, next.month));
  }
  const normalized = new Date(Date.UTC(next.year, next.month - 1, next.day));
  return localDateTimeToUtc({
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: next.hour,
    minute: next.minute,
  }, timeZone).toISOString();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
