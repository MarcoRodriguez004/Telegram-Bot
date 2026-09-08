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

  it("parses a natural expense with category and description", () => {
    expect(parseIntent("Gasté 450 en carro por compra de radiador", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 45_000,
      currency: "MXN",
      category: "carro",
      description: "compra de radiador",
    });
  });

  it("parses an add-to-category expense phrase", () => {
    expect(parseIntent("Agrega a Gastos de carro 450 por compra de radiador", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 45_000,
      currency: "MXN",
      category: "carro",
      description: "compra de radiador",
    });
  });

  it("keeps a quantity in the description when the amount has currency", () => {
    expect(parseIntent("Gasté $450 en carro por compra de 2 radiadores", { currency: "MXN" })).toEqual({
      action: "create_expense",
      amountCents: 45_000,
      currency: "MXN",
      category: "carro",
      description: "compra de 2 radiadores",
    });
  });

  it("does not mistake an item quantity for an expense amount", () => {
    expect(parseIntent("Gasté en carro por compra de 2 radiadores", { currency: "MXN" })).toEqual({
      action: "unknown",
      reason: "invalid_expense_amount",
    });
  });

  it("asks for the amount instead of creating an incomplete expense", () => {
    expect(parseIntent("Agrega a Gastos de carro compra de radiador", { currency: "MXN" })).toEqual({
      action: "unknown",
      reason: "missing_expense_amount",
    });
  });

  it("parses a natural expense history query by category", () => {
    expect(parseIntent("Muéstrame el historial de gastos de carro")).toEqual({
      action: "list_expenses",
      category: "carro",
      range: "all",
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
