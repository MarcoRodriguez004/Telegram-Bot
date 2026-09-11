import { sendMessage } from "../../telegram/client";
import { calculateUserStorageUsage, type UserStorageUsage } from "./accounting";
import type { Env } from "../../types";

export const STORAGE_LIMIT_BYTES = 150 * 1024 * 1024;

interface StorageStatusRow {
  overLimit: number;
}

interface UserDestination {
  telegramUserId: number;
  chatId: number;
}

export async function monitorDatabaseStorage(
  db: D1Database,
  env: Env,
  now = new Date(),
  telegramFetch: typeof fetch = fetch,
): Promise<number | null> {
  const sizeResult = await db.prepare("SELECT 1").run();
  const sizeBytes = sizeResult.meta.size_after;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;

  const previous = await db.prepare("SELECT over_limit AS overLimit FROM storage_status WHERE id = 1")
    .first<StorageStatusRow>();
  const overLimit = sizeBytes >= STORAGE_LIMIT_BYTES;
  const wasOverLimit = previous?.overLimit === 1;
  const nowIso = now.toISOString();

  if (!overLimit || wasOverLimit) {
    await saveStorageStatus(db, sizeBytes, overLimit, nowIso, null);
    return sizeBytes;
  }

  // Only perform the full per-user scan when a new alert is needed. The
  // global D1 size check above remains cheap on every scheduled invocation.
  const userUsage = await calculateUserStorageUsage(db);
  const usageByUser = new Map(userUsage.map((usage) => [usage.telegramUserId, usage]));
  const users = await db.prepare("SELECT telegram_user_id AS telegramUserId, telegram_chat_id AS chatId FROM users")
    .all<UserDestination>();
  const adminUserId = parseTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
  const destinations = users.results.filter((user) => Number.isSafeInteger(user.telegramUserId) && Number.isSafeInteger(user.chatId));

  for (const destination of destinations) {
    if (destination.telegramUserId === adminUserId) continue;
    const usage = usageByUser.get(destination.telegramUserId);
    const userMessage = `⚠️ La base de datos alcanzó el límite de 150 MB. Tu consumo lógico estimado es ${formatMegabytes(usage?.logicalBytes ?? 0)}. No agregues más información por ahora y contacta al programador.`;
    await deliverStorageAlert(env, destination.chatId, userMessage, telegramFetch);
  }

  if (adminUserId !== null) {
    const adminDestination = destinations.find((user) => user.telegramUserId === adminUserId);
    const knownUsers = destinations.map((user) => String(user.telegramUserId)).join(", ") || "ninguno";
    const usageSummary = formatUsageSummary(userUsage);
    const adminMessage = `⚠️ D1 alcanzó 150 MB (${formatMegabytes(sizeBytes)}). Usuarios registrados al cruzar el umbral: ${knownUsers}.\n\nConsumo lógico estimado por usuario:\n${usageSummary}\n\nContacta al programador.`;
    await deliverStorageAlert(env, adminDestination?.chatId ?? adminUserId, adminMessage, telegramFetch);
  }

  await saveStorageStatus(db, sizeBytes, true, nowIso, nowIso);
  return sizeBytes;
}

async function saveStorageStatus(
  db: D1Database,
  sizeBytes: number,
  overLimit: boolean,
  updatedAt: string,
  alertedAt: string | null,
): Promise<void> {
  await db.prepare(
    "INSERT INTO storage_status (id, size_bytes, over_limit, updated_at, alerted_at) VALUES (1, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET size_bytes = excluded.size_bytes, over_limit = excluded.over_limit, updated_at = excluded.updated_at, " +
      "alerted_at = CASE WHEN excluded.over_limit = 0 THEN NULL WHEN storage_status.alerted_at IS NULL THEN excluded.alerted_at ELSE storage_status.alerted_at END",
  ).bind(sizeBytes, overLimit ? 1 : 0, updatedAt, alertedAt).run();
}

async function deliverStorageAlert(
  env: Env,
  chatId: number,
  text: string,
  telegramFetch: typeof fetch,
): Promise<void> {
  try {
    await sendMessage(env, chatId, text, telegramFetch);
  } catch (error) {
    console.error("Storage alert delivery failed", error instanceof Error ? error.message : "unknown error");
  }
}

function parseTelegramUserId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formatMegabytes(sizeBytes: number): string {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUsageSummary(userUsage: UserStorageUsage[]): string {
  if (userUsage.length === 0) return "ninguno";
  const visibleUsers = userUsage.slice(0, 20);
  const lines = visibleUsers.map((usage, index) => `${index + 1}. Telegram ${usage.telegramUserId}: ${formatMegabytes(usage.logicalBytes)}`);
  const omittedUsers = userUsage.length - visibleUsers.length;
  if (omittedUsers > 0) lines.push(`… y ${omittedUsers} usuario(s) más`);
  return lines.join("\n");
}
