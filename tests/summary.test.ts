import { describe, expect, it } from "vitest";
import { getSummary } from "../src/modules/summary/repository";

function createDb() {
  const db = {
    prepare(query: string) {
      return {
        bind(..._values: unknown[]) {
          return {
            async first<T>() {
              if (query.startsWith("SELECT COUNT(*)")) return { count: 2 } as T;
              if (query.startsWith("SELECT COALESCE")) return { totalCents: 12_345 } as T;
              return null;
            },
            async all<T>() {
              if (query.startsWith("SELECT title")) {
                return {
                  results: [{ title: "pagar internet", remindAt: "2026-09-08T15:00:00.000Z" }],
                } as D1Result<T>;
              }
              return {
                results: [{ content: "renovar seguro", url: null, createdAt: "2026-09-07T20:00:00.000Z" }],
              } as D1Result<T>;
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

describe("summary repository", () => {
  it("returns user-scoped tasks, reminders, expenses, and recent notes", async () => {
    const summary = await getSummary(createDb(), {
      userId: 3,
      startAt: "2026-09-07T00:00:00.000Z",
      endAt: "2026-09-08T00:00:00.000Z",
    });

    expect(summary).toEqual({
      pendingTaskCount: 2,
      totalExpenseCents: 12_345,
      upcomingReminders: [{ title: "pagar internet", remindAt: "2026-09-08T15:00:00.000Z" }],
      recentNotes: [{ content: "renovar seguro", url: null, createdAt: "2026-09-07T20:00:00.000Z" }],
    });
  });
});
