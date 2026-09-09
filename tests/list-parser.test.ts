import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("task and reminder list parser", () => {
  it("asks for a task filter when none is stated", () => {
    expect(parseIntent("¿Cuáles son mis tareas?" )).toEqual({ action: "unknown", reason: "unsupported_message" });
    expect(parseIntent("tareas")).toEqual({ action: "list_tasks" });
  });

  it("parses task status filters without stealing task creation", () => {
    expect(parseIntent("tareas completadas")).toEqual({ action: "list_tasks", filter: "completed" });
    expect(parseIntent("tarea comprar medicina")).toEqual({ action: "create_task", title: "comprar medicina" });
  });

  it("parses reminder status filters", () => {
    expect(parseIntent("mis recordatorios pendientes")).toEqual({ action: "list_reminders", filter: "pending" });
    expect(parseIntent("/recordatorios todas")).toEqual({ action: "list_reminders", filter: "all" });
  });
});
