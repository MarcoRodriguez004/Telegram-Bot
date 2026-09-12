import { ensureUser } from "../../db/users";
import type { TelegramAttachment, TelegramMessage } from "../../telegram/types";
import type { InlineKeyboardMarkup } from "../../telegram/client";
import type { Env } from "../../types";
import { createFolder, createNote, findSimilarFolder, getFolderByName } from "./repository";
import { clearPendingFolderSave, savePendingFolderSave } from "../conversation/repository";
import { buildFolderConflictReply } from "./folder-conflict";
import { extractFolderInstruction } from "../../router/parser";

export type MediaReply = string | { text: string; replyMarkup?: InlineKeyboardMarkup };

export async function saveMedia(message: TelegramMessage, env: Env): Promise<MediaReply> {
  const caption = message.caption?.trim().replace(/\s+/g, " ") ?? "";
  const match = /^(?:\/)?(?:guarda|guardar)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu.exec(caption);
  if (!match) {
    return 'Para guardar una foto o documento, envíalo con la descripción «Guarda» o «Guarda recibo de luz». Envía cada archivo por separado.';
  }

  let attachment: TelegramAttachment;
  if (message.document) {
    attachment = { kind: "document", fileId: message.document.file_id };
  } else if (message.photo?.length) {
    const largest = message.photo.reduce((best, photo) => photo.width * photo.height > best.width * best.height ? photo : best);
    attachment = { kind: "photo", fileId: largest.file_id };
  } else {
    return "Adjunta una foto o documento para guardarlo.";
  }

  const folderInstruction = extractFolderInstruction(match[1]?.trim() ?? "");
  const fileName = message.document?.file_name?.trim().replace(/\s+/g, " ");
  const content = folderInstruction.value || fileName || (attachment.kind === "photo" ? "Foto" : "Documento");
  if (content.length > 1_000) {
    return "El nombre o la descripción es demasiado largo. Usa una descripción de hasta 1000 caracteres.";
  }
  if (!message.from) return "No pude identificar al usuario de Telegram.";
  const userId = await ensureUser(env.PERSONAL_ASSISTANT_DB, {
    telegramUserId: message.from.id, telegramChatId: message.chat.id,
    timezone: env.APP_TIMEZONE, currency: env.DEFAULT_CURRENCY,
  });
  let folderId: number | undefined;
  let folderLabel = "";
  if (folderInstruction.folderName) {
    let folder = await getFolderByName(env.PERSONAL_ASSISTANT_DB, userId, folderInstruction.folderName);
    if (!folder) {
      const similar = await findSimilarFolder(env.PERSONAL_ASSISTANT_DB, userId, folderInstruction.folderName);
      if (similar) {
        await savePendingFolderSave(env.PERSONAL_ASSISTANT_DB, {
          userId,
          chatId: message.chat.id,
          pending: {
            content,
            attachment,
            requestedFolderName: folderInstruction.folderName,
            existingFolderId: similar.folder.id,
            existingFolderName: similar.folder.name,
          },
        });
        return buildFolderConflictReply(similar.folder.name, folderInstruction.folderName);
      }
      const createdFolder = await createFolder(env.PERSONAL_ASSISTANT_DB, { userId, name: folderInstruction.folderName });
      folder = createdFolder;
      folderLabel = createdFolder.created ? `\n📁 Carpeta creada: ${createdFolder.name}` : "";
    }
    folderId = folder.id;
    folderLabel += `\nCarpeta: ${folder.name}`;
  }
  const id = await createNote(env.PERSONAL_ASSISTANT_DB, { userId, content, attachment, folderId });
  await clearPendingFolderSave(env.PERSONAL_ASSISTANT_DB, userId);
  const label = attachment.kind === "photo" ? "Foto guardada" : "Documento guardado";
  return `📎 ${label}${folderLabel}\n\n${content}\n\nVer: /guardado_${id}\nLista: /guardados`;
}
