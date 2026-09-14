export interface WhatsAppIdentityEnv {
  WHATSAPP_ALLOWED_USER_ID?: string;
  WHATSAPP_OWNER_TELEGRAM_USER_ID?: string;
  TELEGRAM_ADMIN_USER_ID?: string;
  TELEGRAM_ALLOWED_USER_ID?: string;
}

export async function ensureWhatsAppUser(
  db: D1Database,
  env: WhatsAppIdentityEnv,
  whatsappUserId: string,
): Promise<number | null> {
  const allowedId = normalizeWhatsAppUserId(env.WHATSAPP_ALLOWED_USER_ID);
  const receivedId = normalizeWhatsAppUserId(whatsappUserId);
  const ownerTelegramUserId = parsePositiveInteger(
    env.WHATSAPP_OWNER_TELEGRAM_USER_ID ?? env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID,
  );
  if (!allowedId || !receivedId || allowedId !== receivedId || ownerTelegramUserId === null) return null;

  const owner = await db
    .prepare("SELECT id, whatsapp_user_id FROM users WHERE telegram_user_id = ?")
    .bind(ownerTelegramUserId)
    .first<{ id: number; whatsapp_user_id: string | null }>();
  if (!owner || (owner.whatsapp_user_id !== null && owner.whatsapp_user_id !== receivedId)) return null;

  const existing = await db
    .prepare("SELECT id FROM users WHERE whatsapp_user_id = ?")
    .bind(receivedId)
    .first<{ id: number }>();
  if (existing && existing.id !== owner.id) return null;

  await db
    .prepare("UPDATE users SET whatsapp_user_id = ? WHERE id = ? AND (whatsapp_user_id IS NULL OR whatsapp_user_id = ?)")
    .bind(receivedId, owner.id, receivedId)
    .run();

  const linked = await db
    .prepare("SELECT id FROM users WHERE id = ? AND whatsapp_user_id = ?")
    .bind(owner.id, receivedId)
    .first<{ id: number }>();
  return linked?.id ?? null;
}

export async function claimWhatsAppMessage(db: D1Database, messageId: string): Promise<boolean> {
  if (!/^wamid\.[A-Za-z0-9_.-]{1,512}$/u.test(messageId)) return false;
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_whatsapp_messages (message_id, processed_at) VALUES (?, ?)")
    .bind(messageId, new Date().toISOString())
    .run();
  return result.meta.changes === 1;
}

function normalizeWhatsAppUserId(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\D/g, "");
  return /^\d{7,20}$/u.test(normalized) ? normalized : null;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
