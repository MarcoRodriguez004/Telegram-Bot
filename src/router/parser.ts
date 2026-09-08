import type { Intent } from "./intent";
import { getZonedDateTime, localDateTimeToUtc } from "../shared/dates";
import { MAX_EXPENSE_CENTS, parseAmountCents } from "../shared/money";
import { normalizeHttpUrl } from "../shared/urls";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TASK_TITLE_LENGTH = 500;
const MAX_REMINDER_TITLE_LENGTH = 500;
const MAX_EXPENSE_CATEGORY_LENGTH = 200;
const MAX_NOTE_CONTENT_LENGTH = 1_000;
const TASK_COMMAND = /^(?:\/)?(?:tarea|pendiente)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const REMINDER_COMMAND = /^(?:\/)?(?:recordar|recordatorio)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const NATURAL_REMINDER = /^recu[eé]rdame(?:\s+que)?\s+(.+)$/iu;
const EXPENSE_COMMAND = /^(?:\/)?gasto(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const NATURAL_EXPENSE = /^(?:gast[eé]|apunta(?:me)?|anota)\s+(.+)$/iu;
const NOTE_COMMAND = /^(?:\/)?(?:nota|apunte)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const LINK_COMMAND = /^(?:\/)?(?:guardar|guarda|enlace|link)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const URL_PATTERN = /https?:\/\/[^\s<>]+/iu;
const ANY_SCHEME_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/iu;

export interface ParseOptions {
  now?: Date;
  timezone?: string;
  currency?: string;
}

export function parseIntent(text: string, options: ParseOptions = {}): Intent {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized || normalized.length > MAX_MESSAGE_LENGTH) {
    return { action: "unknown", reason: "unsupported_message" };
  }

  const reminderMatch = REMINDER_COMMAND.exec(normalized) ?? NATURAL_REMINDER.exec(normalized);
  if (reminderMatch) {
    return parseReminder(reminderMatch[1] ?? "", options);
  }

  const expenseMatch = EXPENSE_COMMAND.exec(normalized) ?? NATURAL_EXPENSE.exec(normalized);
  if (expenseMatch) {
    return parseExpense(expenseMatch[1] ?? "", options);
  }

  const linkMatch = LINK_COMMAND.exec(normalized);
  if (linkMatch) {
    return parseNote(linkMatch[1] ?? "", true);
  }

  const noteMatch = NOTE_COMMAND.exec(normalized);
  if (noteMatch) {
    return parseNote(noteMatch[1] ?? "", false);
  }

  const taskMatch = TASK_COMMAND.exec(normalized);
  if (!taskMatch) {
    return { action: "unknown", reason: "unsupported_message" };
  }

  const title = taskMatch[1]?.trim() ?? "";
  if (!title) {
    return { action: "unknown", reason: "missing_task_title" };
  }

  if (title.length > MAX_TASK_TITLE_LENGTH) {
    return { action: "unknown", reason: "task_title_too_long" };
  }

  return { action: "create_task", title };
}

function parseNote(payload: string, requiresUrl: boolean): Intent {
  const value = payload.trim();
  if (!value) {
    return { action: "unknown", reason: requiresUrl ? "missing_note_url" : "missing_note_content" };
  }

  const urlMatch = URL_PATTERN.exec(value);
  if (!urlMatch) {
    if (requiresUrl && ANY_SCHEME_PATTERN.test(value)) {
      return { action: "unknown", reason: "invalid_note_url" };
    }
    if (requiresUrl) {
      return { action: "unknown", reason: "missing_note_url" };
    }
    return value.length <= MAX_NOTE_CONTENT_LENGTH
      ? { action: "save_note", content: value }
      : { action: "unknown", reason: "note_content_too_long" };
  }

  const rawUrl = urlMatch[0].replace(/[.,;:!?)}\]]+$/g, "");
  const url = normalizeHttpUrl(rawUrl);
  if (!url) {
    return { action: "unknown", reason: "invalid_note_url" };
  }

  const before = value.slice(0, urlMatch.index).replace(/^(?:este\s+link|este\s+enlace)\s*/iu, "");
  const after = value.slice(urlMatch.index + urlMatch[0].length);
  const context = `${before} ${after}`.replace(/[\s:,-]+$/g, "").trim();
  const content = context || url;
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { action: "unknown", reason: "note_content_too_long" };
  }

  return { action: "save_note", content, url };
}

function parseExpense(payload: string, options: ParseOptions): Intent {
  const amountMatch = /^(?:(?:\$\s*)|(?:mxn|pesos?)\s*)?(\d[\d.,]*)(?:\s*(?:mxn|pesos?))?(?:\s+(.+))?$/iu.exec(payload);
  if (!amountMatch) {
    return { action: "unknown", reason: "invalid_expense_amount" };
  }

  const amountCents = parseAmountCents(amountMatch[1]);
  if (amountCents === null || amountCents > MAX_EXPENSE_CENTS) {
    return { action: "unknown", reason: "invalid_expense_amount" };
  }

  const category = (amountMatch[2] ?? "").replace(/^(?:en|de|por)\s+/iu, "").trim();
  if (!category) {
    return { action: "unknown", reason: "missing_expense_category" };
  }
  if (category.length > MAX_EXPENSE_CATEGORY_LENGTH) {
    return { action: "unknown", reason: "expense_category_too_long" };
  }

  const currency = (options.currency ?? "MXN").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { action: "unknown", reason: "invalid_currency" };
  }

  return { action: "create_expense", amountCents, currency, category };
}

function parseReminder(payload: string, options: ParseOptions): Intent {
  const titleAndTime = extractReminderTime(payload, options);
  if (titleAndTime.reason) {
    return { action: "unknown", reason: titleAndTime.reason };
  }

  const title = titleAndTime.title.trim();
  if (!title) {
    return { action: "unknown", reason: "missing_reminder_title" };
  }
  if (title.length > MAX_REMINDER_TITLE_LENGTH) {
    return { action: "unknown", reason: "reminder_title_too_long" };
  }

  return { action: "create_reminder", title, remindAt: titleAndTime.remindAt! };
}

function extractReminderTime(payload: string, options: ParseOptions): { title: string; remindAt?: string; reason?: string } {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? "America/Mexico_City";
  const localMatch = /\s+(hoy|ma[ñn]ana)(?:\s+a\s+las?\s+(\d{1,2})(?::(\d{2}))?)?$/iu.exec(payload);
  const relativeMatch = /\s+en\s+(\d+)\s+(minutos?|horas?)$/iu.exec(payload);

  try {
    if (localMatch) {
      const title = payload.slice(0, localMatch.index);
      const currentLocal = getZonedDateTime(now, timezone);
      const hour = localMatch[2] === undefined ? 9 : Number(localMatch[2]);
      const minute = localMatch[3] === undefined ? 0 : Number(localMatch[3]);
      if (hour > 23 || minute > 59) {
        return { title, reason: "invalid_reminder_time" };
      }

      const localDay = new Date(Date.UTC(
        currentLocal.year,
        currentLocal.month - 1,
        currentLocal.day + (localMatch[1].toLowerCase().includes("mañ") || localMatch[1].toLowerCase().includes("man") ? 1 : 0),
      ));
      const remindAt = localDateTimeToUtc(
        {
          year: localDay.getUTCFullYear(),
          month: localDay.getUTCMonth() + 1,
          day: localDay.getUTCDate(),
          hour,
          minute,
        },
        timezone,
      );
      if (remindAt.getTime() <= now.getTime()) {
        return { title, reason: "reminder_time_in_past" };
      }
      return { title, remindAt: remindAt.toISOString() };
    }

    if (relativeMatch) {
      const count = Number(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const milliseconds = unit.startsWith("min") ? count * 60_000 : count * 3_600_000;
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(milliseconds)) {
        return { title: payload.slice(0, relativeMatch.index), reason: "invalid_reminder_time" };
      }
      const remindAt = new Date(now.getTime() + milliseconds);
      return { title: payload.slice(0, relativeMatch.index), remindAt: remindAt.toISOString() };
    }
  } catch {
    return { title: payload, reason: "invalid_reminder_timezone" };
  }

  return { title: payload, reason: "missing_reminder_time" };
}
