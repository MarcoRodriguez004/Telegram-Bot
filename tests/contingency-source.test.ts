import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CONTINGENCY_SOURCE_INDEX, fetchLatestContingencyBulletin, parseContingencyText, parseLatestPdfLink } from "../src/modules/contingency/source";

describe("official contingency bulletin parsing", () => {
  it("uses the certificate-compatible canonical official host", () => {
    expect(new URL(CONTINGENCY_SOURCE_INDEX).hostname).toBe("aire.cdmx.gob.mx");
  });

  it("selects the newest PDF from the official directory listing", () => {
    expect(parseLatestPdfLink(`
      <tr><td><a href="comunicado41_09122026.pdf">comunicado41_09122026.pdf</a></td><td>12-Sep-2026 18:00</td></tr>
      <tr><td><a href="comunicado42_09122026.pdf">comunicado42_09122026.pdf</a></td><td>12-Sep-2026 20:00</td></tr>
    `)).toEqual({
      url: "https://aire.cdmx.gob.mx/contingencias/notas/comunicado42_09122026.pdf",
      publishedAt: "2026-09-12T20:00:00.000Z",
    });
  });

  it("extracts phase I restrictions for holograms 0 and 00", () => {
    const bulletin = parseContingencyText(
      "SE MANTIENE LA FASE I DE CONTINGENCIA AMBIENTAL ATMOSFÉRICA POR OZONO. " +
        "Los vehículos con holograma de verificación 0 y 00, engomado amarillo, terminación de placa 5 u 6, deberán suspender su circulación.",
      "https://www.aire.cdmx.gob.mx/contingencias/notas/comunicado42_09122026.pdf",
      "2026-09-12T20:00:00.000Z",
    );

    expect(bulletin).toMatchObject({ active: true, phase: "I" });
    expect(bulletin?.restriction).toMatchObject({
      holograms: ["0", "00"],
      plateLastDigits: [5, 6],
      color: "amarillo",
    });
  });

  it("recognizes a suspension without reporting an active restriction", () => {
    expect(parseContingencyText(
      "SE SUSPENDE LA FASE I DE CONTINGENCIA AMBIENTAL ATMOSFÉRICA.",
      "https://www.aire.cdmx.gob.mx/contingencias/notas/comunicado43.pdf",
      "2026-09-13T10:00:00.000Z",
    )).toMatchObject({ active: false, phase: "I" });
  });

  it("recognizes an active phase when the action follows the phase name", () => {
    expect(parseContingencyText(
      "La Fase I de contingencia ambiental se mantiene por ozono.",
      "https://www.aire.cdmx.gob.mx/contingencias/notas/comunicado44.pdf",
      "2026-09-13T12:00:00.000Z",
    )).toMatchObject({ active: true, phase: "I" });
  });

  it("extracts compressed PDF streams without corrupting binary bytes", async () => {
    const compressed = deflateSync(Buffer.from("[(SE MANTIENE LA FASE I DE CONTINGENCIA. \u0080)] TJ", "latin1"));
    expect([...compressed].some((byte) => byte >= 0x80 && byte <= 0x9f)).toBe(true);
    const prefix = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n");
    const suffix = new TextEncoder().encode("\nendstream\nendobj\n");
    const pdf = new Uint8Array(prefix.length + compressed.length + suffix.length);
    pdf.set(prefix);
    pdf.set(compressed, prefix.length);
    pdf.set(suffix, prefix.length + compressed.length);
    const sourceFetch: typeof fetch = async (input) => input === CONTINGENCY_SOURCE_INDEX
      ? new Response("<tr><td><a href=\"comunicado99_09122026.pdf\">boletín</a></td><td>12-Sep-2026 21:00</td></tr>")
      : new Response(pdf, { headers: { "content-type": "application/pdf" } });

    await expect(fetchLatestContingencyBulletin(sourceFetch)).resolves.toMatchObject({ active: true, phase: "I" });
  });

  it("ignores unrelated official documents", () => {
    expect(parseContingencyText("Boletín informativo sobre calidad del aire.", "https://example.com/a.pdf", "2026-09-12T00:00:00.000Z")).toBeNull();
  });
});
