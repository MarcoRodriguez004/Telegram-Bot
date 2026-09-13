import { sendMessage } from "../../telegram/client";
import type { Env } from "../../types";

const ALERT_COOLDOWN_MS = 15 * 60 * 1_000;
const MAX_DETAIL_LENGTH = 160;

export interface OperationalFailure {
  component: "telegram" | "scheduler" | "openai" | "storage" | "webhook";
  operation: string;
  detail?: string;
  now?: Date;
}

interface OperationalAlertRow {
  failureCount: number;
  lastAlertedAt: string | null;
}

interface AdminDestination {
  chatId: number;
}

export function describeOperationalFailure(error: unknown): string {
  const raw = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error ?? "unknown_error");
  return sanitizeDetail(raw) || "unknown_error";
}

export async function reportOperationalFailure(
  db: D1Database,
  env: Env,
  failure: OperationalFailure,
  telegramFetch: typeof fetch = fetch,
): Promise<void> {
  const now = failure.now ?? new Date();
  const nowIso = now.toISOString();
  const alertKey = `${failure.component}:${failure.operation}`;

  try {
    await db.prepare(
      "INSERT INTO operational_alerts (alert_key, component, operation, failure_count, updated_at) VALUES (?, ?, ?, 1, ?) " +
        "ON CONFLICT(alert_key) DO UPDATE SET failure_count = operational_alerts.failure_count + 1, updated_at = excluded.updated_at",
    ).bind(alertKey, failure.component, failure.operation, nowIso).run();

    const adminId = parseTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
    if (adminId === null) return;

    const destination = await db.prepare(
      "SELECT telegram_chat_id AS chatId FROM users WHERE telegram_user_id = ?",
    ).bind(adminId).first<AdminDestination>();
    const chatId = Number(destination?.chatId ?? adminId);
    if (!Number.isSafeInteger(chatId)) return;

    const row = await db.prepare(
      "SELECT failure_count AS failureCount, last_alerted_at AS lastAlertedAt FROM operational_alerts WHERE alert_key = ?",
    ).bind(alertKey).first<OperationalAlertRow>();
    if (!row || !shouldAlert(row.lastAlertedAt, now)) return;

    const claim = await db.prepare(
      "UPDATE operational_alerts SET last_alerted_at = ?, updated_at = ? WHERE alert_key = ? AND " +
        "(last_alerted_at IS NULL OR last_alerted_at <= ?)",
    ).bind(nowIso, nowIso, alertKey, new Date(now.getTime() - ALERT_COOLDOWN_MS).toISOString()).run();
    if (claim.meta.changes !== 1) return;

    const detail = sanitizeDetail(failure.detail);
    const detailLine = detail ? `\nDetalle: ${detail}` : "";
    await sendMessage(
      env,
      chatId,
      `⚠️ Alerta operativa\nComponente: ${failure.component}\nOperación: ${failure.operation}\nFallos acumulados: ${Math.max(1, Number(row.failureCount))}${detailLine}\nHora local ${formatOperationalTime(now, env.APP_TIMEZONE)}`,
      telegramFetch,
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "operational_alert_failed",
      component: failure.component,
      operation: failure.operation,
      reason: error instanceof Error ? error.name : "unknown_error",
    }));
  }
}

function shouldAlert(lastAlertedAt: string | null, now: Date): boolean {
  if (!lastAlertedAt) return true;
  const last = new Date(lastAlertedAt).getTime();
  return Number.isNaN(last) || now.getTime() - last >= ALERT_COOLDOWN_MS;
}

function sanitizeDetail(value: string | undefined): string {
  return (value ?? "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/giu, "[url]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]+\b/gu, "[telegram-token]")
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
}

function formatOperationalTime(value: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  try {
    return `(${timeZone}): ${new Intl.DateTimeFormat("es-MX", options).format(value)}`;
  } catch {
    return `(UTC): ${new Intl.DateTimeFormat("es-MX", { ...options, timeZone: "UTC" }).format(value)}`;
  }
}

function parseTelegramUserId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
