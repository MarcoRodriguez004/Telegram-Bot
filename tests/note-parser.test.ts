import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("note parser", () => {
  it("saves a link as a note when there is no extra context", () => {
    expect(parseIntent("guardar este link https://example.com/articulo.")).toEqual({
      action: "save_note",
      content: "https://example.com/articulo",
      url: "https://example.com/articulo",
    });
  });

  it("keeps context next to a saved link", () => {
    expect(parseIntent("guardar este link para leer luego: https://example.com")).toEqual({
      action: "save_note",
      content: "para leer luego",
      url: "https://example.com",
    });
  });

  it("saves a text note", () => {
    expect(parseIntent("nota recordar renovar seguro")).toEqual({
      action: "save_note",
      content: "recordar renovar seguro",
    });
  });

  it("does not save an empty note or an unsafe URL", () => {
    expect(parseIntent("/nota")).toEqual({
      action: "unknown",
      reason: "missing_note_content",
    });
    expect(parseIntent("guardar javascript://alert(1)")).toEqual({
      action: "unknown",
      reason: "invalid_note_url",
    });
  });
});
