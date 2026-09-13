import type { VehicleHologram } from "./repository";

export const CONTINGENCY_SOURCE_INDEX = "https://aire.cdmx.gob.mx/contingencias/notas/";
const SOURCE_HOST = "aire.cdmx.gob.mx";
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const SOURCE_BODY_TIMEOUT_MS = 10_000;
const MAX_DECOMPRESSED_TEXT_BYTES = 512 * 1024;

export interface ContingencyRestriction {
  holograms: VehicleHologram[];
  plateLastDigits: number[];
  color: string | null;
  text: string;
  signature: string;
}

export interface ContingencyBulletin {
  active: boolean;
  phase: "I";
  restriction: ContingencyRestriction | null;
  affectedDate: string | null;
  sourceUrl: string;
  publishedAt: string | null;
}

export async function fetchLatestContingencyBulletin(
  sourceFetch: typeof fetch = fetch,
): Promise<ContingencyBulletin | null> {
  const indexResponse = await fetchWithTimeout(sourceFetch, CONTINGENCY_SOURCE_INDEX, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (!indexResponse.ok) throw new Error(`Official contingency index returned HTTP ${indexResponse.status}`);
  const indexBytes = await readLimited(indexResponse, MAX_INDEX_BYTES);
  const latest = parseLatestPdfLink(new TextDecoder("utf-8").decode(indexBytes));
  if (!latest) return null;

  const pdfResponse = await fetchWithTimeout(sourceFetch, latest.url, {
    headers: { accept: "application/pdf" },
  });
  if (!pdfResponse.ok) throw new Error(`Official contingency bulletin returned HTTP ${pdfResponse.status}`);
  const pdfBytes = await readLimited(pdfResponse, MAX_PDF_BYTES);
  const text = await extractPdfText(pdfBytes);
  return parseContingencyText(text, latest.url, latest.publishedAt);
}

export function parseContingencyText(
  input: string,
  sourceUrl: string,
  publishedAt: string | null,
): ContingencyBulletin | null {
  const text = normalizeSourceText(input);
  const phase = /\bFASE\s+(?:I|1)\b/iu.test(text);
  if (!phase) return null;

  const ended = /(?:SE\s+)?(?:SUSPENDE|LEVANTA|FINALIZA|TERMINA)\b[\s\S]{0,140}\bFASE\s+(?:I|1)\b|\bFASE\s+(?:I|1)\b[\s\S]{0,180}(?:SUSPENDE|LEVANTA|FINALIZA|TERMINA)\b/iu.test(text);
  const active = !ended && (
    /(?:SE\s+)?(?:ACTIVA|MANTIENE|CONTIN(?:Ú|U)A|CONTINUA)[\s\S]{0,140}\bFASE\s+(?:I|1)\b/iu.test(text)
    || /\bFASE\s+(?:I|1)\b[\s\S]{0,140}(?:SE\s+)?(?:ACTIVA|MANTIENE|CONTIN(?:Ú|U)A|CONTINUA)\b/iu.test(text)
  );
  if (!active && !ended) return null;

  const restriction = parseRestriction(text);
  const affectedDate = parseAffectedDate(text, publishedAt);
  return { active, phase: "I", restriction, affectedDate, sourceUrl, publishedAt };
}

export function parseLatestPdfLink(html: string): { url: string; publishedAt: string | null } | null {
  const entries: Array<{ url: string; publishedAt: string | null; sortValue: number }> = [];
  const rowPattern = /<tr\b[\s\S]*?<\/tr>/giu;
  for (const row of html.matchAll(rowPattern)) {
    const link = /<a\s+href=["']([^"']+\.pdf)["'][^>]*>/iu.exec(row[0]);
    if (!link) continue;
    const filename = link[1].trim();
    if (!/^comunicado[\w-]+\.pdf$/iu.test(filename)) continue;
    const date = /\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\b/u.exec(stripTags(row[0]));
    const publishedAt = date ? parseDirectoryDate(date) : null;
    entries.push({
      url: new URL(filename, CONTINGENCY_SOURCE_INDEX).toString(),
      publishedAt,
      sortValue: publishedAt ? Date.parse(publishedAt) : 0,
    });
  }
  const latest = entries.sort((left, right) => right.sortValue - left.sortValue)[0];
  return latest ? { url: latest.url, publishedAt: latest.publishedAt } : null;
}

function parseRestriction(text: string): ContingencyRestriction | null {
  const hologramMatch = /holograma(?:s)?(?:\s+de\s+verificaci[oó]n)?\s+((?:0\s*(?:y|o|,)\s*00)|(?:00\s*(?:y|o|,)\s*0))/iu.exec(text);
  if (!hologramMatch || hologramMatch.index === undefined) return null;
  const window = text.slice(hologramMatch.index, hologramMatch.index + 500);
  const color = /engomado\s+(?:color\s+)?(amarillo|rosa|rojo|verde|azul)\b/iu.exec(window)?.[1]?.toLowerCase() ?? null;
  const digitMatch = /terminaci[oó]n(?:es)?(?:\s+de\s+(?:la\s+)?(?:placa|matr[ií]cula))?\s*[:-]?\s*([0-9](?:\s*(?:o|u|y|,)\s*[0-9])*)/iu.exec(window);
  const plateLastDigits = digitMatch ? [...new Set((digitMatch[1].match(/\d/g) ?? []).map(Number))] : [];
  const textEnd = window.search(/[.!?](?:\s|$)/u);
  const restrictionText = (textEnd >= 0 ? window.slice(0, textEnd + 1) : window).trim().slice(0, 600);
  const holograms: VehicleHologram[] = /00/iu.test(hologramMatch[1]) ? ["0", "00"] : ["0"];
  return {
    holograms,
    plateLastDigits,
    color,
    text: restrictionText,
    signature: JSON.stringify({ holograms, plateLastDigits, color, text: restrictionText }),
  };
}

function parseAffectedDate(text: string, publishedAt: string | null): string | null {
  const monthNames = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  const weekdayNames = "lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo";
  const tomorrowMatch = new RegExp(
    `\\bma[ñn]ana\\b[\\s,]*(?:(?:${weekdayNames})\\s+)?(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+(?:de|del)\\s+(\\d{4}))?`,
    "iu",
  ).exec(text);
  if (tomorrowMatch) {
    const day = Number(tomorrowMatch[1]);
    const month = monthNumber(tomorrowMatch[2]);
    const year = inferAffectedYear(tomorrowMatch[3], day, month, publishedAt);
    return year === null ? null : toIsoDate(day, month, year);
  }

  const explicitMatch = new RegExp(
    `\\b(?:el\\s+)?d[ií]a\\s+(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+(?:de|del)\\s+(\\d{4}))?`,
    "iu",
  ).exec(text);
  if (explicitMatch) {
    const year = explicitMatch[3] ? Number(explicitMatch[3]) : publishedAt ? Number(publishedAt.slice(0, 4)) : null;
    return year === null ? null : toIsoDate(Number(explicitMatch[1]), monthNumber(explicitMatch[2]), year);
  }

  const todayMatch = new RegExp(
    `\\bhoy\\b[\\s,]*(?:(?:${weekdayNames})\\s+)?(\\d{1,2})\\s+de\\s+(${monthNames})(?:\\s+(?:de|del)\\s+(\\d{4}))?`,
    "iu",
  ).exec(text);
  if (todayMatch) {
    const day = Number(todayMatch[1]);
    const month = monthNumber(todayMatch[2]);
    const year = inferAffectedYear(todayMatch[3], day, month, publishedAt);
    return year === null ? null : toIsoDate(day, month, year);
  }

  if (/\b(?:el\s+)?d[ií]a\s+de\s+hoy\b/iu.test(text)) return publishedAt?.slice(0, 10) ?? null;
  return null;
}

function inferAffectedYear(
  explicitYear: string | undefined,
  day: number,
  month: number,
  publishedAt: string | null,
): number | null {
  if (explicitYear) return Number(explicitYear);
  if (!publishedAt) return null;
  const publicationDate = publishedAt.slice(0, 10);
  const publicationYear = Number(publicationDate.slice(0, 4));
  const publicationMonth = Number(publicationDate.slice(5, 7));
  const publicationDay = Number(publicationDate.slice(8, 10));
  if (![publicationYear, publicationMonth, publicationDay].every(Number.isInteger)) return null;
  const crossesYear = month < publicationMonth || (month === publicationMonth && day < publicationDay);
  return publicationYear + (crossesYear ? 1 : 0);
}

function monthNumber(value: string): number {
  const months: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
  };
  return months[value.toLowerCase()] ?? 0;
}

function toIsoDate(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const streamToken = new TextEncoder().encode("stream");
  const endStreamToken = new TextEncoder().encode("endstream");
  const objectToken = new TextEncoder().encode("obj");
  let cursor = 0;
  let text = "";
  let decompressedTextBytes = 0;
  while (true) {
    const streamIndex = indexOfBytes(bytes, streamToken, cursor);
    if (streamIndex < 0) break;
    const objectStart = lastIndexOfBytes(bytes, objectToken, streamIndex);
    const dictionary = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, objectStart), streamIndex));
    const endStream = indexOfBytes(bytes, endStreamToken, streamIndex + streamToken.byteLength);
    if (endStream < 0) break;
    if (/\/Filter\s*\/FlateDecode/iu.test(dictionary) && !/\/Subtype\s*\/Image\b/iu.test(dictionary)) {
      let payloadStart = streamIndex + streamToken.byteLength;
      if (bytes[payloadStart] === 13 && bytes[payloadStart + 1] === 10) payloadStart += 2;
      else if (bytes[payloadStart] === 10 || bytes[payloadStart] === 13) payloadStart += 1;
      let payloadEnd = endStream;
      while (payloadEnd > payloadStart && (bytes[payloadEnd - 1] === 10 || bytes[payloadEnd - 1] === 13)) payloadEnd -= 1;
      const compressed = bytes.slice(payloadStart, payloadEnd);
      try {
        const decompressed = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
        decompressedTextBytes += decompressed.byteLength;
        if (decompressedTextBytes > MAX_DECOMPRESSED_TEXT_BYTES) break;
        const decompressedText = new TextDecoder("latin1").decode(decompressed);
        text += extractPdfTextOperators(decompressedText);
      } catch {
        // Some official PDFs are image scans or use an unsupported encoding.
      }
    }
    cursor = endStream + endStreamToken.byteLength;
  }
  return text;
}

function extractPdfTextOperators(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "[") {
      const end = findPdfArrayEnd(value, index);
      if (end >= 0 && hasPdfOperator(value, end + 1, "TJ")) {
        result += `${extractLiteralPdfStrings(value.slice(index + 1, end)).join("")} `;
        index = end;
        continue;
      }
    } else if (value[index] === "(") {
      const end = findPdfLiteralEnd(value, index);
      if (end >= 0 && hasPdfOperator(value, end + 1, "Tj")) {
        result += `${extractLiteralPdfStrings(value.slice(index, end + 1)).join("")} `;
        index = end;
      }
    }
  }
  return result;
}

function findPdfArrayEnd(value: string, start: number): number {
  let arrayDepth = 1;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "(") {
      const end = findPdfLiteralEnd(value, index);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (value[index] === "[") arrayDepth += 1;
    else if (value[index] === "]" && --arrayDepth === 0) return index;
  }
  return -1;
}

function findPdfLiteralEnd(value: string, start: number): number {
  let depth = 1;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

function hasPdfOperator(value: string, start: number, operator: string): boolean {
  let index = start;
  while (index < value.length && /\s/u.test(value[index])) index += 1;
  return value.slice(index, index + operator.length) === operator;
}

function extractLiteralPdfStrings(value: string): string[] {
  const strings: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "(") continue;
    let depth = 1;
    let literal = "";
    for (index += 1; index < value.length && depth > 0; index += 1) {
      const character = value[index];
      if (character === "\\") {
        if (index + 1 < value.length) literal += value[++index];
      } else if (character === "(") {
        depth += 1;
        literal += character;
      } else if (character === ")") {
        depth -= 1;
        if (depth > 0) literal += character;
      } else {
        literal += character;
      }
    }
    if (depth === 0) strings.push(literal);
  }
  return strings;
}

async function fetchWithTimeout(sourceFetch: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await sourceFetch(input, { ...init, signal: controller.signal });
    const host = new URL(response.url || input).hostname;
    if (host !== SOURCE_HOST) throw new Error("Official contingency source redirected to an unexpected host");
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("Official contingency document is too large");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const body = readResponseBody(reader, maxBytes);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const bodyTimeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error("Official contingency response body timed out"));
    }, SOURCE_BODY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([body, bodyTimeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    await body.catch(() => undefined);
    reader.releaseLock();
  }
}

async function readResponseBody(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("Official contingency document is too large");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function normalizeSourceText(value: string): string {
  return value.replace(/\bes-(?:MX|US)|pt-PT/giu, " ").replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/giu, " ").replace(/\s+/g, " ");
}

function parseDirectoryDate(match: RegExpExecArray): string | null {
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}T${match[4].padStart(2, "0")}:${match[5]}:00.000Z`;
}

function indexOfBytes(source: Uint8Array, token: Uint8Array, fromIndex: number): number {
  outer: for (let index = Math.max(0, fromIndex); index <= source.length - token.length; index += 1) {
    for (let offset = 0; offset < token.length; offset += 1) {
      if (source[index + offset] !== token[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function lastIndexOfBytes(source: Uint8Array, token: Uint8Array, beforeIndex: number): number {
  outer: for (let index = Math.min(beforeIndex - token.length, source.length - token.length); index >= 0; index -= 1) {
    for (let offset = 0; offset < token.length; offset += 1) {
      if (source[index + offset] !== token[offset]) continue outer;
    }
    return index;
  }
  return -1;
}
