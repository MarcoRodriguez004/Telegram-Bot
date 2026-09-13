import { describe, expect, it } from "vitest";
import { parseContingencyText, parseLatestPdfLink } from "../src/modules/contingency/source";

describe("official contingency bulletin parsing", () => {
  it("selects the newest PDF from the official directory listing", () => {
    expect(parseLatestPdfLink(`
      <tr><td><a href="comunicado41_09122026.pdf">comunicado41_09122026.pdf</a></td><td>12-Sep-2026 18:00</td></tr>
      <tr><td><a href="comunicado42_09122026.pdf">comunicado42_09122026.pdf</a></td><td>12-Sep-2026 20:00</td></tr>
    `)).toEqual({
      url: "https://www.aire.cdmx.gob.mx/contingencias/notas/comunicado42_09122026.pdf",
      publishedAt: "2026-09-12T20:00:00.000Z",
    });
  });

  it("extracts phase I restrictions for holograms 0 and 00", () => {
    const bulletin = parseContingencyText(
      "SE MANTIENE LA FASE I DE CONTINGENCIA AMBIENTAL ATMOSFÉRICA POR OZONO. " +
        "Los vehículos con holograma de verificación 0 y 00, engomado amarillo, terminación de placa 5 o 6, deberán suspender su circulación.",
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

  it("ignores unrelated official documents", () => {
    expect(parseContingencyText("Boletín informativo sobre calidad del aire.", "https://example.com/a.pdf", "2026-09-12T00:00:00.000Z")).toBeNull();
  });
});
