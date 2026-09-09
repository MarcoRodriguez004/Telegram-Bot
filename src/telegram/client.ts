import type { Env } from "../types";
import { isTelegramFileId } from "./types";
import type { TelegramAttachment } from "./types";

interface TelegramApiResponse {
  ok?: boolean;
}

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  await callTelegram(env, "sendMessage", { chat_id: chatId, text }, telegramFetch);
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
  method: "sendMessage" | "sendPhoto" | "sendDocument",
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
