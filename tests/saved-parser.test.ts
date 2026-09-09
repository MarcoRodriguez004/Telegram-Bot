import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("saved item commands", () => {
  it.each(["Mis guardados", "muéstrame mis guardados", "/guardados", "/guardados@my_bot"])("lists with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "list_notes" });
  });
  it.each(["/guardados_30", "mis guardados antes 30"])("continues with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "list_notes", beforeId: 30 });
  });
  it.each(["/guardado_123", "/guardado 123", "ver guardado 123", "/guardado_123@my_bot"])("retrieves with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "get_note", noteId: 123 });
  });
  it.each(["/guardado_0", "/guardados_0", "/guardado_99999999999999999999999", "/guardado -1", "/guardado 1 OR 1=1"])("rejects %s", (text) => {
    expect(parseIntent(text).action).toBe("unknown");
  });
});
