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
    restrictionSignature: restriction
      ? JSON.stringify({ signature: restriction.signature, affectedDate: bulletin.affectedDate })
      : null,
    restrictionsText: restriction?.text ?? null,
    sourceUrl: bulletin.sourceUrl,
    publishedAt: bulletin.publishedAt,
    now: now.toISOString(),
  });
  if (!saved.changed) return false;

  const shouldNotify = (bulletin.active && restriction !== null) || Boolean(saved.previous?.active && !bulletin.active);
  if (!shouldNotify) return true;
  const recipients = await listContingencyRecipients(db, bulletin.active ? restriction : null);
  const message = formatContingencyAlert(bulletin.active, restriction, saved.previous, bulletin.sourceUrl, bulletin.affectedDate);
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
  affectedDate: string | null,
): string {
  if (!active) {
    return `✅ La CAMe informó que terminó la Fase I de contingencia ambiental.\n\nFuente oficial: ${sourceUrl}`;
  }
  const digits = restriction?.plateLastDigits.join(" y ") ?? "no identificadas automáticamente";
  const color = restriction?.color ? ` (${restriction.color})` : "";
  const day = affectedDate ? formatAffectedDate(affectedDate) : "no identificado en el boletín";
  const heading = previous?.active ? "🔁 Cambiaron las restricciones de la Fase I" : "🚨 Se activó la Fase I de contingencia ambiental";
  return `${heading}\n\nDía de afectación: ${day}.\nHologramas 0 y 00: terminación ${digits}${color}.\n${restriction?.text ?? "Consulta el boletín oficial para conocer la restricción completa."}\n\nFuente oficial: ${sourceUrl}`;
}

function formatAffectedDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "no identificado en el boletín";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
