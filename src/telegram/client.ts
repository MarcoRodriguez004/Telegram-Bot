import type { Env } from "../types";
import { isTelegramFileId } from "./types";
import type { TelegramAttachment } from "./types";

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
}

const MAX_TELEGRAM_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 2_000;
const MAX_TELEGRAM_TEXT_LENGTH = 4_096;

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  replyMarkup?: InlineKeyboardMarkup;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  telegramFetch: typeof fetch = fetch,
  options: SendMessageOptions = {},
): Promise<void> {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunks[index] };
    if (index === chunks.length - 1 && options.replyMarkup) body.reply_markup = options.replyMarkup;
    await callTelegram(env, "sendMessage", body, telegramFetch);
  }
}

export async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  telegramFetch: typeof fetch = fetch,
  text?: string,
): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  await callTelegram(env, "answerCallbackQuery", body, telegramFetch);
}

export async function sendAttachment(
  env: Env,
  chatId: number,
  attachment: TelegramAttachment,
  caption: string,
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  if (!isTelegramFileId(attachment.fileId)) throw new Error("Invalid Telegram file id");
  const method = attachment.kind === "photo" ? "sendPhoto" : "sendDocument";
  await callTelegram(env, method, {
    chat_id: chatId, [attachment.kind]: attachment.fileId, caption,
  }, telegramFetch);
}

export async function setMyCommands(
  env: Env,
  commands: TelegramBotCommand[],
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  await callTelegram(env, "setMyCommands", {
    commands,
    scope: { type: "all_private_chats" },
  }, telegramFetch);
}

export async function sendDocumentContent(
  env: Env,
  chatId: number,
  filename: string,
  content: string,
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  if (!filename.trim() || filename.length > 120) throw new Error("Invalid document filename");
  if (content.length > 45 * 1024 * 1024) throw new Error("Document content is too large");

  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("document", new Blob([content], { type: "application/json" }), filename);
  await callTelegramRequest(env, "sendDocument", { method: "POST", body: form }, telegramFetch);
}

async function callTelegram(
  env: Env,
  method: "sendMessage" | "sendPhoto" | "sendDocument" | "answerCallbackQuery" | "setMyCommands",
  body: Record<string, unknown>,
  telegramFetch: typeof fetch,
): Promise<void> {
  await callTelegramRequest(env, method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, telegramFetch);
}

async function callTelegramRequest(
  env: Env,
  method: "sendMessage" | "sendPhoto" | "sendDocument" | "answerCallbackQuery" | "setMyCommands",
  init: RequestInit,
  telegramFetch: typeof fetch,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_TELEGRAM_ATTEMPTS; attempt += 1) {
    let response: Response;
    let payload: TelegramApiResponse | null = null;
    try {
      response = await telegramFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, init);
      payload = await readTelegramPayload(response);
    } catch (error) {
      if (attempt === MAX_TELEGRAM_ATTEMPTS) throw error;
      await retryTelegramRequest(method, attempt, undefined, undefined);
      continue;
    }

    if (response.ok && payload?.ok === true) return;

    const retryAfterSeconds = payload?.parameters?.retry_after;
    const retryable = isRetryableTelegramFailure(response.status);
    if (!retryable || attempt === MAX_TELEGRAM_ATTEMPTS) {
      const description = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API request failed with status ${response.status}${description}`);
    }
    await retryTelegramRequest(method, attempt, response.status, retryAfterSeconds);
  }

  throw new Error("Telegram API request failed after retries");
}

async function readTelegramPayload(response: Response): Promise<TelegramApiResponse> {
  try {
    return await response.json() as TelegramApiResponse;
  } catch {
    return {};
  }
}

function isRetryableTelegramFailure(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function retryTelegramRequest(
  method: string,
  attempt: number,
  status: number | undefined,
  retryAfterSeconds: number | undefined,
): Promise<void> {
  const serverDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds !== undefined
    ? retryAfterSeconds * 1_000
    : 0;
  const backoffDelay = 250 * 2 ** (attempt - 1);
  const delayMs = Math.min(MAX_RETRY_DELAY_MS, Math.max(serverDelay, backoffDelay));
  console.warn(JSON.stringify({ event: "telegram_retry", method, attempt, status: status ?? "network", delayMs }));
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function splitTelegramText(text: string): string[] {
  if (text.length <= MAX_TELEGRAM_TEXT_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_TELEGRAM_TEXT_LENGTH) {
    const preferredBreak = remaining.lastIndexOf("\n", MAX_TELEGRAM_TEXT_LENGTH);
    const breakAt = preferredBreak > MAX_TELEGRAM_TEXT_LENGTH - 600 ? preferredBreak : MAX_TELEGRAM_TEXT_LENGTH;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
