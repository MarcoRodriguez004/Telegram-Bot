export interface Env {
  PERSONAL_ASSISTANT_DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_ALLOWED_USER_ID: string;
  APP_TIMEZONE: string;
  DEFAULT_CURRENCY: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}
