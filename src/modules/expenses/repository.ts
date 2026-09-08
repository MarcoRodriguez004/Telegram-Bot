import { MAX_EXPENSE_CENTS } from "../../shared/money";

export interface CreateExpenseInput {
  userId: number;
  amountCents: number;
  currency: string;
  category: string;
  description?: string;
  occurredAt?: string;
  createdAt?: string;
}

export interface ExpenseHistoryInput {
  userId: number;
  category?: string;
  limit?: number;
}

export interface ExpenseHistoryEntry {
  amountCents: number;
  currency: string;
  category: string;
  description: string | null;
  occurredAt: string;
}

export interface ExpenseTotal {
  currency: string;
  totalCents: number;
}

export interface ExpenseHistoryResult {
  totals: ExpenseTotal[];
  expenses: ExpenseHistoryEntry[];
}

export async function createExpense(db: D1Database, input: CreateExpenseInput): Promise<number> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_EXPENSE_CENTS) {
    throw new Error("Expense amount is invalid");
  }

  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Expense currency is invalid");
  }

  const category = input.category.trim().replace(/\s+/g, " ");
  if (!category) {
    throw new Error("Expense category is required");
  }
  if (category.length > 200) {
    throw new Error("Expense category is too long");
  }

  const description = input.description?.trim() || null;
  if (description && description.length > 1_000) {
    throw new Error("Expense description is too long");
  }

  const result = await db
    .prepare(
      "INSERT INTO expenses (user_id, amount_cents, currency, category, description, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      input.userId,
      input.amountCents,
      currency,
      category,
      description,
      input.occurredAt ?? new Date().toISOString(),
      input.createdAt ?? new Date().toISOString(),
    )
    .run();

  return result.meta.last_row_id;
}

export async function getExpenseHistory(db: D1Database, input: ExpenseHistoryInput): Promise<ExpenseHistoryResult> {
  if (!Number.isInteger(input.userId) || input.userId < 1) {
    throw new Error("User id is invalid");
  }

  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Expense history limit is invalid");
  }

  const category = input.category?.trim().replace(/\s+/g, " ") || undefined;
  if (category && category.length > 200) {
    throw new Error("Expense category is too long");
  }

  const conditions = ["user_id = ?"];
  const values: Array<number | string> = [input.userId];
  if (category) {
    conditions.push("LOWER(category) = LOWER(?)");
    values.push(category);
  }
  const where = conditions.join(" AND ");

  const totals = await db
    .prepare(
      `SELECT currency, COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE ${where} GROUP BY currency ORDER BY currency ASC`,
    )
    .bind(...values)
    .all<ExpenseTotal>();

  const expenses = await db
    .prepare(
      `SELECT amount_cents AS amountCents, currency, category, description, occurred_at AS occurredAt FROM expenses WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
    .bind(...values, limit)
    .all<ExpenseHistoryEntry>();

  return { totals: totals.results, expenses: expenses.results };
}
