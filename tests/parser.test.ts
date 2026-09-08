import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("parseIntent", () => {
  it("parses a task command", () => {
    expect(parseIntent("tarea comprar medicina")).toEqual({
      action: "create_task",
      title: "comprar medicina",
    });
  });

  it("accepts slash commands and Telegram bot mentions", () => {
    expect(parseIntent("/tarea@personal_assistant_bot  comprar  medicina")).toEqual({
      action: "create_task",
      title: "comprar medicina",
    });
  });

  it("normalizes whitespace in a task title", () => {
    expect(parseIntent("  tarea\n\tcomprar   medicina  ")).toEqual({
      action: "create_task",
      title: "comprar medicina",
    });
  });

  it("does not guess when a task has no title", () => {
    expect(parseIntent("/tarea")).toEqual({
      action: "unknown",
      reason: "missing_task_title",
    });
  });

  it("keeps natural language out of the first deterministic parser", () => {
    expect(parseIntent("comprar medicina mañana")).toEqual({
      action: "unknown",
      reason: "unsupported_message",
    });
  });

  it("requires the exact uppercase confirmation for data deletion", () => {
    expect(parseIntent("/borrar_datos CONFIRMAR")).toEqual({
      action: "delete_data",
      confirmation: true,
    });
    expect(parseIntent("/borrar_datos confirmar")).toEqual({
      action: "unknown",
      reason: "delete_confirmation_required",
    });
    expect(parseIntent("/borrar_datos NO")).toEqual({
      action: "unknown",
      reason: "delete_confirmation_required",
    });
  });
});
