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
