import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("expense parser", () => {
  it("parses a whole amount and category", () => {
    expect(parseIntent("/gasto 450 gasolina", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 45_000,
      currency: "MXN",
      category: "gasolina",
    });
  });

  it("parses Mexican decimal notation", () => {
    expect(parseIntent("gasté 1.250,50 en supermercado", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 125_050,
      currency: "MXN",
      category: "supermercado",
    });
  });

  it("parses a dollar-prefixed decimal amount", () => {
    expect(parseIntent("gasto $99.99 comida", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 9_999,
      currency: "MXN",
      category: "comida",
    });
  });

  it("accepts the US thousands-and-decimal notation too", () => {
    expect(parseIntent("gasto 1,250.50 gasolina", { currency: "MXN" })).toMatchObject({
      action: "create_expense",
      amountCents: 125_050,
    });
  });

  it("does not create an expense without amount or category", () => {
    expect(parseIntent("/gasto 450")).toEqual({
      action: "unknown",
      reason: "missing_expense_category",
    });
    expect(parseIntent("/gasto gasolina")).toEqual({
      action: "unknown",
      reason: "invalid_expense_amount",
    });
  });

  it("rejects an amount above the configured limit", () => {
    expect(parseIntent("/gasto 1000001 gasolina")).toEqual({
      action: "unknown",
      reason: "invalid_expense_amount",
    });
  });
});
