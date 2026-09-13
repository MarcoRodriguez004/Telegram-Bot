import { describe, expect, it } from "vitest";
import { fetchLatestGobMxBulletin, GOBMX_CONTINGENCY_ARCHIVE, parseGobMxBulletinHtml } from "../src/modules/contingency/gobmx";

describe("Gob.mx contingency source", () => {
  it("parses an active official bulletin and its affected date", () => {
    const bulletin = parseGobMxBulletinHtml(
      "<article><h1>SE MANTIENE LA FASE I DE CONTINGENCIA AMBIENTAL</h1>" +
        "<p>Comisión Ambiental de la Megalópolis | 12 de septiembre de 2026</p>" +
        "<p>Para mañana, domingo 13 de septiembre, se mantienen las medidas.</p></article>",
      "https://www.gob.mx/comisionambiental/prensa/boletin-123",
    );

    expect(bulletin).toMatchObject({ active: true, phase: "I", affectedDate: "2026-09-13" });
  });

  it("recognizes an official suspension", () => {
    expect(parseGobMxBulletinHtml(
      "<article><h1>SE SUSPENDE LA FASE I DE CONTINGENCIA AMBIENTAL</h1></article>",
      "https://www.gob.mx/comisionambiental/prensa/boletin-124",
    )).toMatchObject({ active: false, phase: "I" });
  });

  it("selects no status from a challenge page", () => {
    expect(parseGobMxBulletinHtml("<title>Challenge Validation</title>", "https://www.gob.mx/comisionambiental/archivo/prensa")).toBeNull();
  });

  it("finds the latest bulletin when the archive embeds escaped HTML in JavaScript", async () => {
    const articleUrl = "https://www.gob.mx/comisionambiental/prensa/se-435707?idiom=es";
    const archiveHtml = `<script>$("#prensa").append("<a aria-label=\\"SE SUSPENDE LA CONTINGENCIA AMBIENTAL\\" href=\\"/comisionambiental/prensa/se-435707?idiom=es\\" target=\\"_blank\\">Continuar leyendo<\\/a>");</script>`;
    const articleHtml = "<h1>SE SUSPENDE LA CONTINGENCIA AMBIENTAL ATMOSFÉRICA</h1>" +
      "<p>13 de septiembre de 2026. Las medidas se suspenden a partir de las 15:00 horas del día de hoy.</p>";
    const sourceFetch: typeof fetch = async (input) => String(input) === GOBMX_CONTINGENCY_ARCHIVE
      ? new Response(archiveHtml)
      : new Response(articleHtml);

    await expect(fetchLatestGobMxBulletin(sourceFetch)).resolves.toMatchObject({
      active: false,
      sourceUrl: articleUrl,
      affectedDate: "2026-09-13",
    });
  });
});
