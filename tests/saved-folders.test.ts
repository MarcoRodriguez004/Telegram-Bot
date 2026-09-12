import { describe, expect, it } from "vitest";
import { createSqliteDb } from "./helpers/sqlite-db";
import {
  createFolder,
  createNote,
  findSimilarFolder,
  listFolders,
  listNotes,
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
});
