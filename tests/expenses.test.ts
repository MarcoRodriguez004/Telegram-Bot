import { describe, expect, it } from "vitest";
import { createExpense } from "../src/modules/expenses/repository";

function createDb() {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ query, values });
          return {
            async run() {
              return { success: true, meta: { changes: 1, last_row_id: 21 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("expense repository", () => {
  it("stores an expense as integer cents", async () => {
    const { db, calls } = createDb();

    const expenseId = await createExpense(db, {
      userId: 3,
      amountCents: 45_000,
      currency: "MXN",
      category: "gasolina",
      occurredAt: "2026-09-07T20:00:00.000Z",
      createdAt: "2026-09-07T20:01:00.000Z",
    });

    expect(expenseId).toBe(21);
    expect(calls[0]).toEqual({
      query:
        "INSERT INTO expenses (user_id, amount_cents, currency, category, description, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      values: [3, 45_000, "MXN", "gasolina", null, "2026-09-07T20:00:00.000Z", "2026-09-07T20:01:00.000Z"],
    });
  });

  it("rejects invalid expense data before touching the database", async () => {
    const { db, calls } = createDb();

    await expect(createExpense(db, { userId: 3, amountCents: 0, currency: "MXN", category: "gasolina" })).rejects.toThrow(
      "Expense amount is invalid",
    );
    await expect(createExpense(db, { userId: 3, amountCents: 45000, currency: "MX", category: "gasolina" })).rejects.toThrow(
      "Expense currency is invalid",
    );
    await expect(createExpense(db, { userId: 3, amountCents: 45000, currency: "MXN", category: " " })).rejects.toThrow(
      "Expense category is required",
    );
    expect(calls).toHaveLength(0);
  });
});
