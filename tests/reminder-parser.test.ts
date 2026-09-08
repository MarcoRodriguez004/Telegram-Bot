import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

const now = new Date("2026-09-07T19:30:00.000Z");
const options = { now, timezone: "America/Mexico_City" };

describe("reminder parser", () => {
  it("uses 09:00 in the user's timezone when tomorrow has no hour", () => {
    expect(parseIntent("/recordar pagar internet mañana", options)).toEqual({
      action: "create_reminder",
      title: "pagar internet",
      remindAt: "2026-09-08T15:00:00.000Z",
    });
  });

  it("converts an explicit local hour to UTC", () => {
    expect(parseIntent("recordar pagar internet mañana a las 18:30", options)).toEqual({
      action: "create_reminder",
      title: "pagar internet",
      remindAt: "2026-09-09T00:30:00.000Z",
    });
  });

  it("supports relative minutes", () => {
    expect(parseIntent("recuérdame llamar al dentista en 30 minutos", options)).toEqual({
      action: "create_reminder",
      title: "llamar al dentista",
      remindAt: "2026-09-07T20:00:00.000Z",
    });
  });

  it("does not guess a reminder time", () => {
    expect(parseIntent("/recordar pagar internet")).toEqual({
      action: "unknown",
      reason: "missing_reminder_time",
    });
  });

  it("rejects a local time that already passed today", () => {
    expect(parseIntent("/recordar pagar internet hoy a las 08:00", options)).toEqual({
      action: "unknown",
      reason: "reminder_time_in_past",
    });
  });
});
