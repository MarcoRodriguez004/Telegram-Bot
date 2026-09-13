import type { VehicleHologram } from "./repository";

export const CONTINGENCY_SOURCE_INDEX = "https://aire.cdmx.gob.mx/contingencias/notas/";
const SOURCE_HOST = "aire.cdmx.gob.mx";
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;

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
  return { active, phase: "I", restriction, sourceUrl, publishedAt };
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

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const streamToken = new TextEncoder().encode("stream");
  const endStreamToken = new TextEncoder().encode("endstream");
  const objectToken = new TextEncoder().encode("obj");
  let cursor = 0;
  let text = "";
  while (true) {
    const streamIndex = indexOfBytes(bytes, streamToken, cursor);
    if (streamIndex < 0) break;
    const objectStart = lastIndexOfBytes(bytes, objectToken, streamIndex);
    const dictionary = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, objectStart), streamIndex));
    const endStream = indexOfBytes(bytes, endStreamToken, streamIndex + streamToken.byteLength);
    if (endStream < 0) break;
    if (/\/Filter\s*\/FlateDecode/iu.test(dictionary)) {
      let payloadStart = streamIndex + streamToken.byteLength;
      if (bytes[payloadStart] === 13 && bytes[payloadStart + 1] === 10) payloadStart += 2;
      else if (bytes[payloadStart] === 10 || bytes[payloadStart] === 13) payloadStart += 1;
      let payloadEnd = endStream;
      while (payloadEnd > payloadStart && (bytes[payloadEnd - 1] === 10 || bytes[payloadEnd - 1] === 13)) payloadEnd -= 1;
      const compressed = bytes.slice(payloadStart, payloadEnd);
      try {
        const decompressed = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
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
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error("Official contingency document is too large");
  return buffer;
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
