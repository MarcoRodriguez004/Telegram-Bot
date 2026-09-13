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

  it("extracts the term from natural saved-data searches", () => {
    expect(parseIntent("Búsqueda INE")).toEqual({ action: "search", query: "INE" });
    expect(parseIntent("Busca cualquier archivo, foto o nota que contenga INE")).toEqual({
      action: "search",
      query: "INE",
    });
  });

  it("recognizes only the exact console-cleanup command", () => {
    expect(parseIntent("cls")).toEqual({ action: "clear_conversation" });
    expect(parseIntent("Cls")).toEqual({ action: "clear_conversation" });
    expect(parseIntent("cls ahora")).toEqual({ action: "unknown", reason: "unsupported_message" });
  });
});
