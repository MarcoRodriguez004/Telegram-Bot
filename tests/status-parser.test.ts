import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("status and search parser", () => {
  it("parses status, search and export commands", () => {
    expect(parseIntent("/estado")).toEqual({ action: "status" });
    expect(parseIntent("buscar tornillos")).toEqual({ action: "search", query: "tornillos" });
    expect(parseIntent("/exportar")).toEqual({ action: "export_data" });
  });

  it("requires a search phrase", () => {
    expect(parseIntent("/buscar")).toEqual({ action: "unknown", reason: "missing_search_query" });
  });
});
