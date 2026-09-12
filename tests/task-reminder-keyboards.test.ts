import { describe, expect, it } from "vitest";
import {
  buildFilterKeyboard,
  buildGlobalNotificationIntervalKeyboard,
  buildItemKeyboard,
  buildListKeyboard,
  buildNotificationChoiceKeyboard,
  buildPersistentAlertKeyboard,
  buildFolderKeyboard,
  buildFolderConflictKeyboard,
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

  it("builds numbered item buttons while keeping hidden item callbacks", () => {
    const keyboard = buildListKeyboard("task", [{
      id: 17,
      title: "comprar medicina",
      status: "pending",
      dueAt: null,
      createdAt: "2026-09-09T18:00:00.000Z",
    }, {
      id: 18,
      title: "pagar tarjeta",
      status: "pending",
      dueAt: null,
      createdAt: "2026-09-09T19:00:00.000Z",
    }], 17, "pending");

    expect(keyboard.inline_keyboard.slice(0, 2).map((row) => row[0].text)).toEqual(["Tarea 1", "Tarea 2"]);
    expect(keyboard.inline_keyboard[0][0].text).not.toContain("comprar medicina");
    expect(keyboard.inline_keyboard[0][0].text).not.toContain("2026-09-09");
    expect(keyboard.inline_keyboard.at(-1)?.[0].text).toBe("Consultar más");
    expect(parseCallbackData(keyboard.inline_keyboard[0][0].callback_data)).toEqual({
      kind: "item", resource: "task", id: 17,
    });
    expect(parseCallbackData(keyboard.inline_keyboard.at(-1)![0].callback_data)).toEqual({
      kind: "page", resource: "task", filter: "pending", beforeId: 17,
    });

    expect(buildListKeyboard("reminder", [{
      id: 9,
      title: "renovar póliza",
      status: "pending",
      remindAt: "2026-09-10T19:00:00.000Z",
      createdAt: "2026-09-09T18:00:00.000Z",
    }], undefined, "pending").inline_keyboard[0][0].text).toBe("Recordatorio 1");
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

  it("labels the global stop according to its scope", () => {
    expect(buildGlobalNotificationIntervalKeyboard("all").inline_keyboard[0][0].text).toBe("Parar todos los avisos");
    expect(buildGlobalNotificationIntervalKeyboard("task").inline_keyboard[0][0].text).toBe("Parar avisos de todas las tareas");
  });

  it("keeps folder names out of callbacks and supports virtual Sin carpeta", () => {
    const keyboard = buildFolderKeyboard("photos", [
      { id: 7, name: "Documentos personales", count: 2 },
      { id: null, name: "Sin carpeta", count: 1 },
    ]);

    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "📁 Documentos personales (2)", "📁 Sin carpeta (1)",
    ]);
    expect(parseCallbackData(keyboard.inline_keyboard[0][0].callback_data)).toEqual({
      kind: "folder_item", noteKind: "photos", folderId: 7,
    });
    expect(parseCallbackData(keyboard.inline_keyboard[1][0].callback_data)).toEqual({
      kind: "folder_item", noteKind: "photos", folderId: null,
    });
  });

  it("asks whether to reuse or create a similar folder", () => {
    const keyboard = buildFolderConflictKeyboard("Documentos personales", "Documentos personles");
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toEqual([
      'Usar "Documentos personales"',
      'Crear "Documentos personles"',
    ]);
    expect(parseCallbackData(keyboard.inline_keyboard[0][0].callback_data)).toEqual({
      kind: "folder_conflict", decision: "use_existing",
    });
    expect(parseCallbackData(keyboard.inline_keyboard[1][0].callback_data)).toEqual({
      kind: "folder_conflict", decision: "create_new",
    });
    expect(keyboard.inline_keyboard.flat().every((button) => button.callback_data.length <= 64)).toBe(true);
  });
});
