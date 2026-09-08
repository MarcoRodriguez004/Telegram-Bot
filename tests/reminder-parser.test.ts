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

  it("supports a relative time before the reminder title", () => {
    expect(parseIntent("recuérdame en 1 minuto apagar la pc", options)).toEqual({
      action: "create_reminder",
      title: "apagar la pc",
      remindAt: "2026-09-07T19:31:00.000Z",
    });
  });

  it("supports written singular relative durations before the title", () => {
    expect(parseIntent("recuérdame en un minuto apagar la pc", options)).toEqual({
      action: "create_reminder",
      title: "apagar la pc",
      remindAt: "2026-09-07T19:31:00.000Z",
    });
  });

  it("understands a natural reminder request with a 12-hour clock", () => {
    expect(parseIntent("Quiero que me recuerdes a las 2pm tomarme mi medicamento", options)).toEqual({
      action: "create_reminder",
      title: "tomarme mi medicamento",
      remindAt: "2026-09-07T20:00:00.000Z",
    });
  });

  it("schedules the next occurrence when an undated clock already passed", () => {
    expect(parseIntent("recuérdame tomarme mi medicamento a las 10am", options)).toEqual({
      action: "create_reminder",
      title: "tomarme mi medicamento",
      remindAt: "2026-09-08T16:00:00.000Z",
    });
  });

  it("finds the explicit clock after another number in the title", () => {
    expect(parseIntent("recuérdame tomar 2 pastillas a las 2pm", options)).toEqual({
      action: "create_reminder",
      title: "tomar 2 pastillas",
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
