export function normalizeHttpUrl(value: string): string | null {
  const url = value.trim();
  if (url.length > 2_048) return null;

  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return null;
    }
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" && !parsed.search && !parsed.hash ? "" : "/");
  } catch {
    return null;
  }
}
