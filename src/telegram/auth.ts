import type { Env } from "../types";
import type { TelegramUpdate } from "./types";

export function hasValidWebhookSecret(request: Request, env: Env): boolean {
  const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return Boolean(env.TELEGRAM_WEBHOOK_SECRET) && received === env.TELEGRAM_WEBHOOK_SECRET;
}

export function isAuthorizedUpdate(update: TelegramUpdate): boolean {
  const message = update.message ?? update.callback_query?.message;
  const user = update.message?.from ?? update.callback_query?.from;
  return (
    message?.chat.type === "private" &&
    user?.is_bot === false
  );
}
