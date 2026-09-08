export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function getZonedDateTime(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

export function localDateTimeToUtc(local: LocalDateTime, timeZone: string): Date {
  const utcGuess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const zonedGuess = getZonedDateTime(new Date(utcGuess), timeZone);
  const zonedGuessAsUtc = Date.UTC(
    zonedGuess.year,
    zonedGuess.month - 1,
    zonedGuess.day,
    zonedGuess.hour,
    zonedGuess.minute,
  );
  const offset = zonedGuessAsUtc - utcGuess;
  const result = new Date(utcGuess - offset);

  if (Number.isNaN(result.getTime())) {
    throw new Error("Invalid local date");
  }

  return result;
}
