import { parseContingencyText, type ContingencyBulletin } from "./source";

export const GOBMX_CONTINGENCY_ARCHIVE = "https://www.gob.mx/comisionambiental/archivo/prensa";
const GOBMX_HOST = "www.gob.mx";
const MAX_GOBMX_BYTES = 512 * 1024;
const GOBMX_TIMEOUT_MS = 8_000;

export type GobMxBulletin = ContingencyBulletin & { sourceUrl: string };

export async function fetchLatestGobMxBulletin(sourceFetch: typeof fetch = fetch): Promise<GobMxBulletin | null> {
  const archiveResponse = await fetchWithTimeout(sourceFetch, GOBMX_CONTINGENCY_ARCHIVE);
  if (!archiveResponse.ok) throw new Error(`Gob.mx contingency archive returned HTTP ${archiveResponse.status}`);
  const archiveText = new TextDecoder().decode(await readLimited(archiveResponse));
  const articleUrl = findLatestContingencyArticle(archiveText);
  if (!articleUrl) return null;

  const articleResponse = await fetchWithTimeout(sourceFetch, articleUrl);
  if (!articleResponse.ok) throw new Error(`Gob.mx contingency bulletin returned HTTP ${articleResponse.status}`);
  const articleHtml = new TextDecoder().decode(await readLimited(articleResponse));
  const articleText = stripTags(articleHtml);
  const publishedAt = parsePublishedDate(articleText);
  const bulletin = parseContingencyText(articleText, articleUrl, publishedAt);
  return bulletin ? { ...bulletin, sourceUrl: articleUrl } : null;
}

export function parseGobMxBulletinHtml(html: string, sourceUrl: string, publishedAt: string | null = null): GobMxBulletin | null {
  const text = stripTags(html);
  const bulletin = parseContingencyText(text, sourceUrl, publishedAt ?? parsePublishedDate(text));
  return bulletin ? { ...bulletin, sourceUrl } : null;
}

function findLatestContingencyArticle(html: string): string | null {
  const normalizedHtml = html.replace(/\\([/"'])/gu, "$1");
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of normalizedHtml.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const href = /\bhref=["']([^"']*\/comisionambiental\/prensa\/[^"']+)["']/iu.exec(attributes)?.[1];
    if (!href) continue;
    const title = stripTags(decodeHtmlEntities(`${attributes} ${match[2] ?? ""}`));
    if (!/(?:contingencia|hoy\s+no\s+circula|fase\s+i)/iu.test(title)) continue;
    try {
      const url = new URL(decodeHtmlEntities(href), GOBMX_CONTINGENCY_ARCHIVE);
      if (url.hostname !== GOBMX_HOST || url.pathname.includes("/archivo/")) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchWithTimeout(sourceFetch: typeof fetch, input: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOBMX_TIMEOUT_MS);
  try {
    const response = await sourceFetch(input, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Personal-Assistant-Bot/1.0 (+https://www.gob.mx/comisionambiental)",
      },
      signal: controller.signal,
    });
    const host = new URL(response.url || input).hostname;
    if (host !== GOBMX_HOST) throw new Error("Gob.mx source redirected to an unexpected host");
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GOBMX_BYTES) throw new Error("Gob.mx response is too large");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const bodyTimeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Gob.mx response body timed out")), GOBMX_TIMEOUT_MS);
  });
  try {
    const bytes = new Uint8Array(await Promise.race([response.arrayBuffer(), bodyTimeout]));
    if (bytes.byteLength > MAX_GOBMX_BYTES) throw new Error("Gob.mx response is too large");
    return bytes;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function parsePublishedDate(text: string): string | null {
  const match = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/iu.exec(text);
  if (!match) return null;
  const months: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const month = months[match[2].toLowerCase()];
  // The source provides only a calendar date. Noon UTC keeps that date stable
  // when it is later formatted in America/Mexico_City.
  const date = new Date(Date.UTC(Number(match[3]), month - 1, Number(match[1]), 12));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&aacute;/giu, "á")
    .replace(/&eacute;/giu, "é")
    .replace(/&iacute;/giu, "í")
    .replace(/&oacute;/giu, "ó")
    .replace(/&uacute;/giu, "ú")
    .replace(/&ntilde;/giu, "ñ");
}
