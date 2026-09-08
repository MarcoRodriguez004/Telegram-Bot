export const MAX_EXPENSE_CENTS = 100_000_000;

export function parseAmountCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(/^\$|^MXN/i, "");
  if (!/^\d[\d.,]*$/.test(normalized)) return null;

  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");
  const hasBothSeparators = lastDot >= 0 && lastComma >= 0;
  const decimalSeparator = hasBothSeparators ? (lastDot > lastComma ? "." : ",") : null;
  const singleSeparator = !hasBothSeparators && lastDot >= 0 !== lastComma >= 0;
  const separator = decimalSeparator ?? (singleSeparator ? (lastDot >= 0 ? "." : ",") : null);

  let majorPart = normalized;
  let minorPart = "";
  if (separator !== null) {
    const separatorIndex = normalized.lastIndexOf(separator);
    const candidateMinor = normalized.slice(separatorIndex + 1);
    const isDecimal = candidateMinor.length > 0 && candidateMinor.length <= 2;
    if (isDecimal) {
      majorPart = normalized.slice(0, separatorIndex);
      minorPart = candidateMinor;
    }
  }

  majorPart = majorPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(majorPart) || (minorPart && !/^\d{1,2}$/.test(minorPart))) return null;

  const cents = Number(majorPart) * 100 + Number((minorPart || "0").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
