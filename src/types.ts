export interface Env {
  PERSONAL_ASSISTANT_DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /** @deprecated Kept only as an admin-ID fallback for existing deployments. */
  TELEGRAM_ALLOWED_USER_ID?: string;
  TELEGRAM_ADMIN_USER_ID?: string;
  APP_TIMEZONE: string;
  DEFAULT_CURRENCY: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_ALLOWED_USER_ID?: string;
  WHATSAPP_OWNER_TELEGRAM_USER_ID?: string;
}
