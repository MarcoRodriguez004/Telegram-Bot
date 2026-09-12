import { describe, expect, it } from "vitest";
import { createSqliteDb } from "./helpers/sqlite-db";
import {
  createFolder,
  createNote,
  deleteFolder,
  findSimilarFolder,
  moveNoteToFolder,
  listFolders,
  listNotes,
  renameFolder,
} from "../src/modules/notes/repository";

async function seedUser(db: D1Database, telegramUserId: number): Promise<number> {
  const result = await db.prepare(
    "INSERT INTO users (telegram_user_id, telegram_chat_id, created_at) VALUES (?, ?, ?)",
  ).bind(telegramUserId, telegramUserId, "2026-09-10T12:00:00.000Z").run();
  return result.meta.last_row_id;
}

describe("saved folder repository", () => {
  it("creates per-user folders with normalized names and does not duplicate them", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1001);

    const first = await createFolder(db, { userId, name: "  Documentos   Personales " });
    const duplicate = await createFolder(db, { userId, name: "documentos personales" });

    expect(first).toEqual({ id: 1, name: "Documentos Personales", created: true });
    expect(duplicate).toEqual({ id: 1, name: "Documentos Personales", created: false });
  });

  it("lists dynamic folders by content type and includes virtual Sin carpeta", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1002);
    const folder = await createFolder(db, { userId, name: "Familia" });

    await createNote(db, {
      userId,
      content: "foto familiar",
      folderId: folder.id,
      attachment: { kind: "photo", fileId: "AgACAgQAAx" },
    });
    await createNote(db, {
      userId,
      content: "documento familiar",
      folderId: folder.id,
      attachment: { kind: "document", fileId: "BQACAgQAAx" },
    });
    await createNote(db, { userId, content: "nota sin carpeta" });

    await expect(listFolders(db, userId, "photos")).resolves.toEqual([
      { id: folder.id, name: "Familia", count: 1 },
    ]);
    await expect(listFolders(db, userId, "documents")).resolves.toEqual([
      { id: folder.id, name: "Familia", count: 1 },
    ]);
    await expect(listFolders(db, userId, "links")).resolves.toEqual([
      { id: null, name: "Sin carpeta", count: 1 },
    ]);
  });

  it("filters notes by the selected folder and keeps users isolated", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1003);
    const otherUserId = await seedUser(db, 1004);
    const folder = await createFolder(db, { userId, name: "Trabajo" });
    const otherFolder = await createFolder(db, { userId: otherUserId, name: "Trabajo" });

    await createNote(db, { userId, content: "visible", folderId: folder.id });
    await createNote(db, { userId, content: "unfiled" });
    await createNote(db, { userId: otherUserId, content: "private", folderId: otherFolder.id });

    await expect(listNotes(db, userId, undefined, "all", folder.id)).resolves.toMatchObject({
      notes: [{ content: "visible" }],
    });
    await expect(listNotes(db, userId, undefined, "all", null)).resolves.toMatchObject({
      notes: [{ content: "unfiled" }],
    });
    await expect(listNotes(db, userId, undefined, "all", otherFolder.id)).rejects.toThrow("Folder not found");
  });

  it("finds the closest folder only for the same user when similarity reaches 70%", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1005);
    const otherUserId = await seedUser(db, 1006);
    const folder = await createFolder(db, { userId, name: "Documentos personales" });
    await createFolder(db, { userId: otherUserId, name: "Documentos personales" });

    const match = await findSimilarFolder(db, userId, "Documentos personles");
    expect(match?.folder).toEqual({ id: folder.id, name: folder.name });
    expect(match?.similarity).toBeGreaterThanOrEqual(0.7);
    await expect(findSimilarFolder(db, userId, "Recetas de cocina")).resolves.toBeNull();
  });

  it("renames a folder without allowing a duplicate normalized name", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1007);
    await createFolder(db, { userId, name: "Familia" });
    await createFolder(db, { userId, name: "Trabajo" });

    await expect(renameFolder(db, { userId, currentName: "Familia", newName: "Personal" })).resolves.toEqual({
      id: 1,
      name: "Personal",
    });
    await expect(renameFolder(db, { userId, currentName: "Personal", newName: " trabajo " })).rejects.toThrow("Folder name already exists");
    await expect(getFolderByNameForTest(db, userId, "Personal")).resolves.toEqual({ id: 1, name: "Personal" });
  });

  it("deletes a folder while preserving its notes as unfiled", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1008);
    const folder = await createFolder(db, { userId, name: "Temporal" });
    await createNote(db, { userId, content: "conservar", folderId: folder.id });

    await expect(deleteFolder(db, { userId, name: "Temporal" })).resolves.toEqual({ id: folder.id, name: "Temporal" });
    await expect(listNotes(db, userId, undefined, "all", null)).resolves.toMatchObject({ notes: [{ content: "conservar" }] });
    await expect(listFolders(db, userId, "all")).resolves.toEqual([{ id: null, name: "Sin carpeta", count: 1 }]);
  });

  it("moves a note only within the authenticated user's folders", async () => {
    const { db } = createSqliteDb();
    const userId = await seedUser(db, 1009);
    const otherUserId = await seedUser(db, 1010);
    const source = await createFolder(db, { userId, name: "Entrada" });
    const destination = await createFolder(db, { userId, name: "Archivo" });
    const otherFolder = await createFolder(db, { userId: otherUserId, name: "Archivo" });
    const noteId = await createNote(db, { userId, content: "mover", folderId: source.id });

    await expect(moveNoteToFolder(db, { userId, noteId, folderId: destination.id })).resolves.toBe(true);
    await expect(listNotes(db, userId, undefined, "all", destination.id)).resolves.toMatchObject({ notes: [{ id: noteId, content: "mover" }] });
    await expect(moveNoteToFolder(db, { userId, noteId, folderId: otherFolder.id })).rejects.toThrow("Folder not found");
    await expect(moveNoteToFolder(db, { userId, noteId, folderId: null })).resolves.toBe(true);
  });
});

async function getFolderByNameForTest(db: D1Database, userId: number, name: string) {
  return db.prepare("SELECT id, name FROM saved_folders WHERE user_id = ? AND normalized_name = ?")
    .bind(userId, name.toLocaleLowerCase("es-MX")).first<{ id: number; name: string }>();
}
