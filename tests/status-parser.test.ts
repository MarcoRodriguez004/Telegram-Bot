import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("status and search parser", () => {
  it("parses status, search and export commands", () => {
    expect(parseIntent("/estado")).toEqual({ action: "status" });
    expect(parseIntent("buscar tornillos")).toEqual({ action: "search", query: "tornillos" });
    expect(parseIntent('/buscar tornillos tipo:tarea estado:pendiente desde:2026-09-01 hasta:2026-09-30 pagina:2'))
      .toEqual({
        action: "search",
        query: "tornillos",
        kind: "task",
        status: "pending",
        from: "2026-09-01",
        to: "2026-09-30",
        page: 2,
      });
    expect(parseIntent('/buscar póliza carpeta:"documentos personales"')).toEqual({
      action: "search",
      query: "póliza",
      folderName: "documentos personales",
    });
    expect(parseIntent("/exportar")).toEqual({ action: "export_data" });
  });

  it("requires a search phrase", () => {
    expect(parseIntent("/buscar")).toEqual({ action: "unknown", reason: "missing_search_query" });
    expect(parseIntent("/buscar tipo:tarea")).toEqual({ action: "unknown", reason: "missing_search_query" });
  });
});
