import { describe, expect, it } from "vitest";
import { interpretMessage } from "../src/ai/openai";

type AiCandidate = Record<string, unknown>;

function candidate(overrides: AiCandidate): AiCandidate {
  return {
    action: "reply",
    title: null,
    when: null,
    amount: null,
    currency: null,
    category: null,
    description: null,
    content: null,
    url: null,
    beforeId: null,
    noteId: null,
    range: null,
    message: "No entendí.",
    suggestion: null,
    missing: [],
    ...overrides,
  };
}

function openAiResponse(value: AiCandidate): Response {
  return new Response(JSON.stringify({
    status: "completed",
    output_text: JSON.stringify(value),
  }), { status: 200 });
}

function openAiRestResponse(value: AiCandidate): Response {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    }],
  }), { status: 200 });
}

describe("interpretMessage", () => {
  it("does not call OpenAI when the key is not configured", async () => {
    let calls = 0;
    const result = await interpretMessage("quiero organizar mi día", {
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async () => {
        calls += 1;
        return openAiResponse(candidate({}));
      },
    });

    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("uses Responses Structured Outputs and normalizes a task", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await interpretMessage("por favor apunta comprar medicina", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return openAiResponse(candidate({ action: "create_task", title: "comprar medicina", message: null }));
      },
    });

    expect(result).toEqual({ action: "create_task", title: "comprar medicina" });
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      input: "por favor apunta comprar medicina",
      store: false,
      text: { format: { type: "json_schema", name: "assistant_intent", strict: true } },
    });
  });

  it("reads structured output from the raw Responses API payload", async () => {
    const result = await interpretMessage("por favor anota comprar medicina", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async () => openAiRestResponse(candidate({
        action: "create_task",
        title: "comprar medicina",
        message: null,
      })),
    });

    expect(result).toEqual({ action: "create_task", title: "comprar medicina" });
  });

  it("normalizes task and reminder list intents with optional filters", async () => {
    const responses = [
      openAiResponse(candidate({ action: "list_tasks", filter: null, message: null })),
      openAiResponse(candidate({ action: "list_reminders", filter: "completed", message: null })),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    await expect(interpretMessage("cuáles son mis tareas", { apiKey: "test-key", fetcher })).resolves.toEqual({ action: "list_tasks" });
    await expect(interpretMessage("mis recordatorios completados", { apiKey: "test-key", fetcher })).resolves.toEqual({
      action: "list_reminders",
      filter: "completed",
    });
  });

  it("normalizes dynamic saved-folder intents without inventing folder IDs", async () => {
    const responses = [
      openAiResponse(candidate({ action: "create_folder", name: "Documentos personales", message: null })),
      openAiResponse(candidate({ action: "list_notes", kind: "documents", folderName: "Documentos personales", message: null })),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    await expect(interpretMessage("crea una carpeta para mis documentos", { apiKey: "test-key", fetcher })).resolves.toEqual({
      action: "create_folder",
      name: "Documentos personales",
    });
    await expect(interpretMessage("muéstrame sus archivos", { apiKey: "test-key", fetcher })).resolves.toEqual({
      action: "list_notes",
      kind: "documents",
      folderName: "Documentos personales",
    });
  });

  it("keeps a suggested interpretation when the model asks for confirmation", async () => {
    const userMessage = "Necesito consultar una lista";
    const suggestedText = "mis tareas";
    const question = "¿Quieres consultar tu lista de pendientes?";

    await expect(interpretMessage(userMessage, {
      apiKey: "test-key",
      fetcher: async () => openAiResponse(candidate({
        action: "clarify",
        question,
        suggestion: suggestedText,
        message: null,
      })),
    })).resolves.toEqual({
      action: "clarify",
      question,
      missing: [],
      suggestedText,
    });
  });

  it("normalizes reminder and expense data through business validation", async () => {
    const responses = [
      openAiResponse(candidate({
        action: "create_reminder",
        title: "pagar la luz",
        when: "mañana a las 09:00",
        message: null,
      })),
      openAiResponse(candidate({
        action: "create_expense",
        amount: "450",
        category: "carro",
        description: "compra de radiador",
        currency: "MXN",
        message: null,
      })),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    const reminder = await interpretMessage("avísame cuando sea", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      now: new Date("2026-09-08T12:00:00.000Z"),
      fetcher,
    });
    const expense = await interpretMessage("anota un gasto", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher,
    });

    expect(reminder).toMatchObject({ action: "create_reminder", title: "pagar la luz" });
    expect(new Date((reminder as { remindAt: string }).remindAt).getTime()).toBeGreaterThan(new Date("2026-09-08T12:00:00.000Z").getTime());
    expect(expense).toEqual({
      action: "create_expense",
      amountCents: 45_000,
      currency: "MXN",
      category: "carro",
      description: "compra de radiador",
    });
  });

  it("rejects an unsafe action returned by the model", async () => {
    const result = await interpretMessage("borra todo", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async () => openAiResponse(candidate({ action: "delete_data", message: null })),
    });

    expect(result).toBeNull();
  });

  it("fails closed on API errors and invalid structured output", async () => {
    const failed = await interpretMessage("haz algo", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async () => new Response("no", { status: 500 }),
    });
    const invalid = await interpretMessage("haz algo", {
      apiKey: "test-key",
      timezone: "America/Mexico_City",
      currency: "MXN",
      fetcher: async () => new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
    });

    expect(failed).toBeNull();
    expect(invalid).toBeNull();
  });
});
