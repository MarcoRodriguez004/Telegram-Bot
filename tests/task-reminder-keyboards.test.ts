import { describe, expect, it } from "vitest";
import {
  buildFilterKeyboard,
  buildItemKeyboard,
  buildListKeyboard,
  buildNotificationChoiceKeyboard,
  buildPersistentAlertKeyboard,
  parseCallbackData,
} from "../src/telegram/keyboards";

describe("task and reminder inline keyboards", () => {
  it("builds the four status choices", () => {
    expect(buildFilterKeyboard("task").inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Pendientes", "Completadas", "Canceladas", "Todas",
    ]);
    expect(buildFilterKeyboard("reminder").inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Pendientes", "Completados", "Cancelados", "Todos",
    ]);
  });

  it("builds hidden item and pagination callbacks with visible names and dates", () => {
    const keyboard = buildListKeyboard("task", [{
      id: 17,
      title: "comprar medicina",
      status: "pending",
      dueAt: null,
      createdAt: "2026-09-09T18:00:00.000Z",
    }], 17, "pending", "America/Mexico_City");

    expect(keyboard.inline_keyboard[0][0].text).toContain("comprar medicina");
    expect(keyboard.inline_keyboard[0][0].text).toContain("2026-09-09");
    expect(keyboard.inline_keyboard[0][0].text).not.toContain("17");
    expect(keyboard.inline_keyboard.at(-1)?.[0].text).toBe("Consultar más");
    expect(parseCallbackData(keyboard.inline_keyboard[0][0].callback_data)).toEqual({
      kind: "item", resource: "task", id: 17,
    });
    expect(parseCallbackData(keyboard.inline_keyboard.at(-1)![0].callback_data)).toEqual({
      kind: "page", resource: "task", filter: "pending", beforeId: 17,
    });
  });

  it("parses item actions and rejects malformed callbacks", () => {
    expect(parseCallbackData("pa:r:a:e:9")).toEqual({ kind: "action", resource: "reminder", action: "edit", id: 9 });
    expect(parseCallbackData("pa:t:a:n:9")).toEqual({ kind: "action", resource: "task", action: "notify_stop", id: 9 });
    expect(parseCallbackData("pa:t:n:10:9")).toEqual({ kind: "notification_set", resource: "task", intervalMinutes: 10, id: 9 });
    expect(parseCallbackData("pa:t:f:x")).toEqual({ kind: "filter", resource: "task", filter: "cancelled" });
    expect(parseCallbackData("pa:t:a:c:0")).toBeNull();
    expect(parseCallbackData("other:task:1")).toBeNull();
  });

  it("builds an action menu for a selected item", () => {
    expect(buildItemKeyboard("task", 17, "pending", "pending").inline_keyboard.flat().map((button) => button.text)).toEqual([
      "✅ Completar", "✏️ Editar", "❌ Cancelar", "⚙️ Configurar avisos", "↩️ Volver",
    ]);
  });

  it("builds the creation choices and alert action buttons", () => {
    const choiceKeyboard = buildNotificationChoiceKeyboard("task", 17);
    expect(choiceKeyboard.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Sin avisos", "Cada 5 minutos", "Cada 10 minutos", "Cada 20 minutos", "Cada 30 minutos", "Cada 60 minutos",
    ]);
    expect(buildPersistentAlertKeyboard("reminder", 9).inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Parar avisos de este recordatorio", "✅ Completar", "❌ Cancelar",
    ]);
  });
});
