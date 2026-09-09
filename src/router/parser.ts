import type { Intent } from "./intent";
import { getZonedDateTime, localDateTimeToUtc } from "../shared/dates";
import { MAX_EXPENSE_CENTS, parseAmountCents } from "../shared/money";
import { normalizeHttpUrl } from "../shared/urls";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TASK_TITLE_LENGTH = 500;
const MAX_REMINDER_TITLE_LENGTH = 500;
const MAX_EXPENSE_CATEGORY_LENGTH = 200;
const MAX_EXPENSE_DESCRIPTION_LENGTH = 1_000;
const MAX_NOTE_CONTENT_LENGTH = 1_000;
const TASK_COMMAND = /^(?:\/)?(?:tarea|pendiente)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const REMINDER_COMMAND = /^(?:\/)?(?:recordar|recordatorio)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const NATURAL_REMINDER = /^(?:recu[eé]rdame|quiero\s+que\s+me\s+recuerdes?|me\s+(?:puedes|podrías)\s+recordar|av[ií]same)(?:\s+que)?\s+(.+)$/iu;
const TASK_LIST = /^(?:\/?(?:mis\s+)?tareas)(?:\s+(pendientes?|complet(?:a(?:s)?|ad[ao]s?)|cancelad(?:a|as|o|os)|todas?))?$/iu;
const REMINDER_LIST = /^(?:\/?(?:mis\s+)?recordatorios)(?:\s+(pendientes?|complet(?:a(?:s)?|ad[ao]s?)|cancelad(?:a|as|o|os)|todas?))?$/iu;
const EXPENSE_COMMAND = /^(?:\/)?gasto(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const NATURAL_EXPENSE = /^gast[eé]\s+(.+)$/iu;
const NATURAL_EXPENSE_NOTE = /^(?:apunta(?:me)?|anota)\s+(.+)$/iu;
const ADD_EXPENSE = /^agrega(?:r)?\s+(?:a\s+)?(?:los?\s+)?gastos?(?:\s+de)?\s+(.+)$/iu;
const EXPENSE_HISTORY = /^(?:(?:mu[eé]strame|ens[eé]ñame|dame)\s+)?(?:el\s+)?historial\s+de\s+gastos?(?:\s+de\s+(.+))?$/iu;
const NATURAL_EXPENSE_HISTORY = /^(?:mis\s+gastos?|gastos?)\s+(?:de|en)\s+(.+)$/iu;
const NOTE_COMMAND = /^(?:\/)?(?:nota|apunte)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const SAVED_LIST = /^(?:(?:mu[eé]strame\s+)?mis\s+guardados|\/?guardados)(?:_(\d+)|\s+antes\s+(\d+))?(?:@[a-z0-9_]+)?$/iu;
const SAVED_ITEM = /^(?:ver\s+guardado\s+|\/?guardado(?:_|\s+))(\d+)(?:@[a-z0-9_]+)?$/iu;
const LINK_COMMAND = /^(?:\/)?(?:guardar|guarda|enlace|link)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const SUMMARY_COMMAND = /^(?:\/)?resumen(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;
const DELETE_DATA_COMMAND = /^(?:\/)?borrar_datos(?:@[a-z0-9_]+)?\s+CONFIRMAR$/u;
const DELETE_DATA_PREFIX = /^(?:\/)?borrar_datos(?:@[a-z0-9_]+)?(?:\s+.*)?$/iu;
const URL_PATTERN = /https?:\/\/[^\s<>]+/iu;
const ANY_SCHEME_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/iu;
const RELATIVE_REMINDER = /(?:^|\s+)en\s+(\d+|un(?:a)?)\s+(min(?:uto)?s?|h(?:ora)?s?)\b/iu;
const REMINDER_DATE_PATTERN = /\b(hoy|ma[ñn]ana)\b/iu;
const REMINDER_TIME_PATTERN = /(?:(?:a\s+las?\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de\s+la\s+(?:ma[ñn]ana|tarde|noche))?)/iu;
const EXPENSE_AMOUNT_PATTERN = /(?<![\w$.,])(?:\$\s*|(?:mxn|pesos?)\s*)?\d[\d.,]*(?:\s*(?:mxn|pesos?))?(?![\w.,])/iu;

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

  const savedList = SAVED_LIST.exec(normalized);
  if (savedList) {
    const cursor = savedList[1] ?? savedList[2];
    if (cursor === undefined) return { action: "list_notes" };
    const beforeId = Number(cursor);
    return Number.isSafeInteger(beforeId) && beforeId > 0
      ? { action: "list_notes", beforeId }
      : { action: "unknown", reason: "invalid_saved_id" };
  }
  const savedItem = SAVED_ITEM.exec(normalized);
  if (savedItem) {
    const noteId = Number(savedItem[1]);
    return Number.isSafeInteger(noteId) && noteId > 0
      ? { action: "get_note", noteId }
      : { action: "unknown", reason: "invalid_saved_id" };
  }

  if (DELETE_DATA_COMMAND.test(normalized)) {
    return { action: "delete_data", confirmation: true };
  }

  if (DELETE_DATA_PREFIX.test(normalized)) {
    return { action: "unknown", reason: "delete_confirmation_required" };
  }

  const summaryMatch = SUMMARY_COMMAND.exec(normalized);
  if (summaryMatch) {
    return parseSummary(summaryMatch[1] ?? "");
  }

  const taskListMatch = TASK_LIST.exec(normalized);
  if (taskListMatch) {
    return parseListIntent("list_tasks", taskListMatch[1]);
  }

  const reminderListMatch = REMINDER_LIST.exec(normalized);
  if (reminderListMatch) {
    return parseListIntent("list_reminders", reminderListMatch[1]);
  }

  const reminderMatch = REMINDER_COMMAND.exec(normalized) ?? NATURAL_REMINDER.exec(normalized);
  if (reminderMatch) {
    return parseReminder(reminderMatch[1] ?? "", options);
  }

  const expenseHistoryMatch = EXPENSE_HISTORY.exec(normalized) ?? NATURAL_EXPENSE_HISTORY.exec(normalized);
  if (expenseHistoryMatch) {
    const category = expenseHistoryMatch[1]?.trim();
    return category ? { action: "list_expenses", category, range: "all" } : { action: "unknown", reason: "missing_expense_history_category" };
  }

  const expenseCommandMatch = EXPENSE_COMMAND.exec(normalized);
  if (expenseCommandMatch) {
    return parseExpense(expenseCommandMatch[1] ?? "", options);
  }

  const naturalExpenseMatch = NATURAL_EXPENSE.exec(normalized);
  if (naturalExpenseMatch) {
    return parseNaturalExpense(naturalExpenseMatch[1] ?? "", options);
  }

  const naturalExpenseNoteMatch = NATURAL_EXPENSE_NOTE.exec(normalized);
  if (naturalExpenseNoteMatch) {
    const payload = naturalExpenseNoteMatch[1] ?? "";
    return findNaturalExpenseAmount(payload).match
      ? parseNaturalExpense(payload, options)
      : { action: "unknown", reason: "unsupported_message" };
  }

  const addExpenseMatch = ADD_EXPENSE.exec(normalized);
  if (addExpenseMatch) {
    return parseNaturalExpense(addExpenseMatch[1] ?? "", options);
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

function parseSummary(payload: string): Intent {
  const range = payload.trim().toLowerCase();
  if (!range || range === "hoy" || range === "día" || range === "dia") {
    return { action: "summary", range: "today" };
  }
  if (range === "semana") {
    return { action: "summary", range: "week" };
  }
  if (range === "mes") {
    return { action: "summary", range: "month" };
  }
  return { action: "unknown", reason: "invalid_summary_range" };
}

function parseListIntent(action: "list_tasks" | "list_reminders", payload?: string): Intent {
  const value = payload?.trim().toLowerCase();
  if (!value) return { action };
  if (/^pendientes?$/iu.test(value)) return { action, filter: "pending" };
  if (/^complet(?:a(?:s)?|ad[ao]s?)$/iu.test(value)) return { action, filter: "completed" };
  if (/^cancelad(?:a|as|o|os)$/iu.test(value)) return { action, filter: "cancelled" };
  if (/^todas?$/iu.test(value)) return { action, filter: "all" };
  return { action: "unknown", reason: action === "list_tasks" ? "invalid_task_filter" : "invalid_reminder_filter" };
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

function parseNaturalExpense(payload: string, options: ParseOptions): Intent {
  const amountCandidate = findNaturalExpenseAmount(payload);
  const amountMatch = amountCandidate.match;
  if (!amountMatch || amountMatch.index === undefined) {
    return { action: "unknown", reason: amountCandidate.found ? "invalid_expense_amount" : "missing_expense_amount" };
  }

  const amountValue = amountMatch[0].replace(/\s*(?:mxn|pesos?)\s*$/iu, "").trim();
  const amountCents = parseAmountCents(amountValue);
  if (amountCents === null || amountCents > MAX_EXPENSE_CENTS) {
    return { action: "unknown", reason: "invalid_expense_amount" };
  }

  const details = parseNaturalExpenseDetails(
    `${payload.slice(0, amountMatch.index)} ${payload.slice(amountMatch.index + amountMatch[0].length)}`,
  );
  if (!details.category) {
    return { action: "unknown", reason: "missing_expense_category" };
  }
  if (details.category.length > MAX_EXPENSE_CATEGORY_LENGTH) {
    return { action: "unknown", reason: "expense_category_too_long" };
  }
  if (details.description && details.description.length > MAX_EXPENSE_DESCRIPTION_LENGTH) {
    return { action: "unknown", reason: "expense_description_too_long" };
  }

  const currency = (options.currency ?? "MXN").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { action: "unknown", reason: "invalid_currency" };
  }

  return { action: "create_expense", amountCents, currency, ...details };
}

function parseNaturalExpenseDetails(payload: string): { category: string; description?: string } {
  const value = payload
    .trim()
    .replace(/^(?:en|de|por)\s+/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    return { category: "" };
  }

  const separator = /\s+(?:por|para)\s+|\s*[:,;-]\s*/iu.exec(value);
  if (separator && separator.index !== undefined) {
    return {
      category: value.slice(0, separator.index).trim(),
      description: value.slice(separator.index + separator[0].length).trim() || undefined,
    };
  }

  const words = value.split(" ");
  if (words.length > 1) {
    return { category: words[0], description: words.slice(1).join(" ") };
  }
  return { category: value };
}

function findNaturalExpenseAmount(value: string): { match: RegExpExecArray | null; found: boolean } {
  const pattern = new RegExp(EXPENSE_AMOUNT_PATTERN.source, "giu");
  const candidates: RegExpExecArray[] = [];
  let candidate: RegExpExecArray | null;
  while ((candidate = pattern.exec(value)) !== null) {
    candidates.push(candidate);
    if (candidate[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }

  if (candidates.length === 0) {
    return { match: null, found: false };
  }

  const currencyCandidates = candidates.filter((item) => /\$|mxn|pesos?/iu.test(item[0]));
  if (currencyCandidates.length === 1) {
    return { match: currencyCandidates[0], found: true };
  }
  if (currencyCandidates.length > 1 || candidates.length !== 1) {
    return { match: null, found: true };
  }

  const onlyCandidate = candidates[0];
  const before = value.slice(0, onlyCandidate.index).trim();
  const after = value.slice(onlyCandidate.index + onlyCandidate[0].length).trim();
  const isAmountPosition = !before || /\bpor\s*$/iu.test(before) || /^(?:en|por|para)\b/iu.test(after);
  return { match: isAmountPosition ? onlyCandidate : null, found: true };
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
  const relativeMatch = RELATIVE_REMINDER.exec(payload);

  try {
    if (relativeMatch) {
      const countToken = relativeMatch[1].toLowerCase();
      const count = countToken === "un" || countToken === "una" ? 1 : Number(countToken);
      const unit = relativeMatch[2].toLowerCase();
      const milliseconds = unit.startsWith("min") ? count * 60_000 : count * 3_600_000;
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(milliseconds)) {
        return { title: payload.slice(0, relativeMatch.index), reason: "invalid_reminder_time" };
      }
      const remindAt = new Date(now.getTime() + milliseconds);
      const before = payload.slice(0, relativeMatch.index).trim();
      const after = payload.slice(relativeMatch.index + relativeMatch[0].length).replace(/^que\s+/iu, "").trim();
      return { title: [before, after].filter(Boolean).join(" "), remindAt: remindAt.toISOString() };
    }

    const dateMatch = REMINDER_DATE_PATTERN.exec(payload);
    const timeMatch = findExplicitReminderTime(payload);
    if (!dateMatch && !timeMatch) {
      return { title: payload, reason: "missing_reminder_time" };
    }

    const currentLocal = getZonedDateTime(now, timezone);
    const parsedTime = timeMatch ? parseReminderClock(timeMatch) : { hour: 9, minute: 0 };
    if (!parsedTime) {
      return { title: payload, reason: "invalid_reminder_time" };
    }

    const titleParts = [dateMatch, timeMatch]
      .filter((match): match is RegExpExecArray => match !== null)
      .sort((left, right) => (right.index ?? 0) - (left.index ?? 0));
    let title = payload;
    for (const match of titleParts) {
      title = `${title.slice(0, match.index)} ${title.slice((match.index ?? 0) + match[0].length)}`;
    }
    title = title.replace(/^\s*(?:que|para)\s+/iu, "").replace(/\s+/g, " ").trim();

    const dateLabel = dateMatch?.[1].toLowerCase() ?? "";
    const explicitTomorrow = dateLabel.includes("mañ") || dateLabel.includes("man");
    const localDay = new Date(Date.UTC(
      currentLocal.year,
      currentLocal.month - 1,
      currentLocal.day + (explicitTomorrow ? 1 : 0),
    ));
    let remindAt = localDateTimeToUtc(
      {
        year: localDay.getUTCFullYear(),
        month: localDay.getUTCMonth() + 1,
        day: localDay.getUTCDate(),
        ...parsedTime,
      },
      timezone,
    );

    if (!dateMatch && timeMatch && remindAt.getTime() <= now.getTime()) {
      localDay.setUTCDate(localDay.getUTCDate() + 1);
      remindAt = localDateTimeToUtc(
        {
          year: localDay.getUTCFullYear(),
          month: localDay.getUTCMonth() + 1,
          day: localDay.getUTCDate(),
          ...parsedTime,
        },
        timezone,
      );
    }

    if (remindAt.getTime() <= now.getTime()) {
      return { title, reason: "reminder_time_in_past" };
    }
    return { title, remindAt: remindAt.toISOString() };
  } catch {
    return { title: payload, reason: "invalid_reminder_timezone" };
  }

}

function hasExplicitReminderTime(value: string): boolean {
  return /a\s+las|:|a\.?\s*m\.?|p\.?\s*m\.?|de\s+la/iu.test(value);
}

function findExplicitReminderTime(value: string): RegExpExecArray | null {
  const pattern = new RegExp(REMINDER_TIME_PATTERN.source, "giu");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (hasExplicitReminderTime(match[0])) {
      return match;
    }
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }
  return null;
}

function parseReminderClock(match: RegExpExecArray): { hour: number; minute: number } | null {
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const marker = (match[3] ?? "").toLowerCase().replace(/\./g, "");
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) {
    return null;
  }

  if (!marker) {
    return hour <= 23 ? { hour, minute } : null;
  }
  if (hour < 1 || hour > 12) {
    return null;
  }

  const isAfternoon = marker.startsWith("p") || marker.includes("tarde") || marker.includes("noche");
  const isMorning = marker.startsWith("a") || marker.includes("mañana") || marker.includes("manana");
  if (!isAfternoon && !isMorning) {
    return null;
  }

  return {
    hour: isAfternoon ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour,
    minute,
  };
}
