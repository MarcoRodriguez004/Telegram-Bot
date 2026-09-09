import type { Env } from "../types";
import { isTelegramFileId } from "./types";
import type { TelegramAttachment } from "./types";

interface TelegramApiResponse {
  ok?: boolean;
}

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

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  telegramFetch: typeof fetch = fetch,
  options: SendMessageOptions = {},
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (options.replyMarkup) body.reply_markup = options.replyMarkup;
  await callTelegram(env, "sendMessage", body, telegramFetch);
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

async function callTelegram(
  env: Env,
  method: "sendMessage" | "sendPhoto" | "sendDocument" | "answerCallbackQuery",
  body: Record<string, unknown>,
  telegramFetch: typeof fetch,
): Promise<void> {
  const response = await telegramFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as TelegramApiResponse;
  if (payload.ok !== true) {
    throw new Error("Telegram API returned an unsuccessful response");
  }
}
