import { sendMessage } from "../../telegram/client";
import type { Env } from "../../types";
import { reportOperationalFailure } from "../operations/alerts";
import {
  listContingencyRecipients,
  saveContingencyState,
  type ContingencyState,
} from "./repository";
import { fetchLatestContingencyBulletin } from "./source";

export async function monitorContingency(
  db: D1Database,
  env: Env,
  now = new Date(),
  sourceFetch: typeof fetch = fetch,
  telegramFetch: typeof fetch = fetch,
): Promise<boolean> {
  if (now.getUTCMinutes() % 15 !== 0) return false;
  const bulletin = await fetchLatestContingencyBulletin(sourceFetch);
  if (!bulletin) throw new Error("Official contingency bulletin could not be parsed");

  // Keep a parsed restriction even when the PDF does not expose plate digits.
  // The "always" mode can still be notified; vehicle matching must remain
  // conservative and will not match without a known digit.
  const restriction = bulletin.restriction;
  const saved = await saveContingencyState(db, {
    active: bulletin.active,
    phase: bulletin.phase,
    restrictionSignature: restriction?.signature ?? null,
    restrictionsText: restriction?.text ?? null,
    sourceUrl: bulletin.sourceUrl,
    publishedAt: bulletin.publishedAt,
    now: now.toISOString(),
  });
  if (!saved.changed) return false;

  const shouldNotify = (bulletin.active && restriction !== null) || Boolean(saved.previous?.active && !bulletin.active);
  if (!shouldNotify) return true;
  const ownerTelegramUserId = parseConfiguredTelegramUserId(env.TELEGRAM_ADMIN_USER_ID ?? env.TELEGRAM_ALLOWED_USER_ID);
  // Contingency delivery is temporarily owner-only. Fail closed if the owner
  // is not configured instead of falling back to every user's preference.
  const recipients = ownerTelegramUserId === null
    ? []
    : await listContingencyRecipients(db, bulletin.active ? restriction : null, ownerTelegramUserId);
  const message = formatContingencyAlert(bulletin.active, restriction, saved.previous, bulletin.sourceUrl);
  for (const recipient of recipients) {
    try {
      await sendMessage(env, recipient.chatId, message, telegramFetch);
    } catch (error) {
      await reportOperationalFailure(db, env, {
        component: "telegram",
        operation: "contingency_alert_delivery",
        detail: error instanceof Error ? error.name : "delivery_failure",
        now,
      }, telegramFetch);
    }
  }
  return true;
}

function formatContingencyAlert(
  active: boolean,
  restriction: { holograms: string[]; plateLastDigits: number[]; color: string | null; text: string } | null,
  previous: ContingencyState | null,
  sourceUrl: string,
): string {
  if (!active) {
    return `✅ La CAMe informó que terminó la Fase I de contingencia ambiental.\n\nFuente oficial: ${sourceUrl}`;
  }
  const digits = restriction?.plateLastDigits.join(" y ") ?? "no identificadas automáticamente";
  const color = restriction?.color ? ` (${restriction.color})` : "";
  const heading = previous?.active ? "🔁 Cambiaron las restricciones de la Fase I" : "🚨 Se activó la Fase I de contingencia ambiental";
  return `${heading}\n\nHologramas 0 y 00: terminación ${digits}${color}.\n${restriction?.text ?? "Consulta el boletín oficial para conocer la restricción completa."}\n\nFuente oficial: ${sourceUrl}`;
}

function parseConfiguredTelegramUserId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
