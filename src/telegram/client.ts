import type { Env } from "../types";

interface TelegramApiResponse {
  ok?: boolean;
}

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  const response = await telegramFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as TelegramApiResponse;
  if (payload.ok !== true) {
    throw new Error("Telegram API returned an unsuccessful response");
  }
}
