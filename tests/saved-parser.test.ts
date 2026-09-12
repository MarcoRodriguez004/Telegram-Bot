import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("saved item commands", () => {
  it.each(["muestrame las imagenes guardadas", "muéstrame las fotos guardadas", "imágenes guardadas", "Muestrame mis fotos", "Muéstrame mis fotos", "Mis imágenes"])("lists %s as photos", (text) => {
    expect(parseIntent(text)).toEqual({ action: "list_folders", kind: "photos" });
  });

  it.each(["Mis guardados", "muéstrame mis guardados", "/guardados", "/guardados@my_bot"])("lists with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "list_notes" });
  });
  it.each(["/guardados_30", "mis guardados antes 30"])("continues with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "list_notes", beforeId: 30 });
  });
  it("resolves saved-media pronouns only when a matching context exists", () => {
    expect(parseIntent("Muestramelas", { savedNotesContext: { kind: "photos" } })).toEqual({
      action: "list_notes",
      kind: "photos",
    });
    expect(parseIntent("muestra más", {
      savedNotesContext: { kind: "photos", folderId: 4, nextBeforeId: 17 },
    })).toEqual({ action: "list_notes", kind: "photos", folderId: 4, beforeId: 17 });
    expect(parseIntent("Muestramelas")).toEqual({ action: "unknown", reason: "unsupported_message" });
  });
  it("parses dynamic folder commands and folder-scoped saved lists", () => {
    expect(parseIntent("Crea la carpeta Documentos personales")).toEqual({
      action: "create_folder",
      name: "Documentos personales",
    });
    expect(parseIntent("¿Cuáles son mis carpetas?")).toEqual({ action: "list_folders" });
    expect(parseIntent("mis archivos de la carpeta Trabajo")).toEqual({
      action: "list_notes",
      kind: "documents",
      folderName: "Trabajo",
    });
  });
  it("parses saved-folder management commands", () => {
    expect(parseIntent("Renombra la carpeta Familia a Personal")).toEqual({
      action: "rename_folder",
      currentName: "Familia",
      newName: "Personal",
    });
    expect(parseIntent("Elimina la carpeta Temporal")).toEqual({
      action: "delete_folder",
      name: "Temporal",
    });
    expect(parseIntent("Mueve el guardado 123 a la carpeta Archivo")).toEqual({
      action: "move_note",
      noteId: 123,
      folderName: "Archivo",
    });
    expect(parseIntent("Mueve el guardado 123 a Sin carpeta")).toEqual({
      action: "move_note",
      noteId: 123,
      folderName: null,
    });
  });
  it.each(["/guardado_123", "/guardado 123", "ver guardado 123", "/guardado_123@my_bot"])("retrieves with %s", (text) => {
    expect(parseIntent(text)).toEqual({ action: "get_note", noteId: 123 });
  });
  it.each(["/guardado_0", "/guardados_0", "/guardado_99999999999999999999999", "/guardado -1", "/guardado 1 OR 1=1"])("rejects %s", (text) => {
    expect(parseIntent(text).action).toBe("unknown");
  });
});
