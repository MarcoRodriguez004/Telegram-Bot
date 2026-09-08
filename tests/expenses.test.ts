import { describe, expect, it } from "vitest";
import { createExpense, getExpenseHistory } from "../src/modules/expenses/repository";

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

  it("returns category totals and the newest expenses for one user", async () => {
    const queries: Array<{ query: string; values: unknown[] }> = [];
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            queries.push({ query, values });
            return {
              async all<T>() {
                if (query.startsWith("SELECT currency")) {
                  return { results: [{ currency: "MXN", totalCents: 90_000 }] } as D1Result<T>;
                }
                return {
                  results: [
                    {
                      amountCents: 45_000,
                      currency: "MXN",
                      category: "carro",
                      description: "compra de radiador",
                      occurredAt: "2026-09-07T20:00:00.000Z",
                    },
                  ],
                } as D1Result<T>;
              },
            };
          },
        };
      },
    };

    const result = await getExpenseHistory(db as unknown as D1Database, { userId: 3, category: "carro" });

    expect(result).toEqual({
      totals: [{ currency: "MXN", totalCents: 90_000 }],
      expenses: [
        {
          amountCents: 45_000,
          currency: "MXN",
          category: "carro",
          description: "compra de radiador",
          occurredAt: "2026-09-07T20:00:00.000Z",
        },
      ],
    });
    expect(queries[0].values).toEqual([3, "carro"]);
    expect(queries[1].values).toEqual([3, "carro", 20]);
  });
});
