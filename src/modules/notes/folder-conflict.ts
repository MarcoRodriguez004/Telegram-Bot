import type { InlineKeyboardMarkup } from "../../telegram/client";
import { buildFolderConflictKeyboard } from "../../telegram/keyboards";

export type FolderConflictReply = {
  text: string;
  replyMarkup: InlineKeyboardMarkup;
};

export function buildFolderConflictReply(existingName: string, requestedName: string): FolderConflictReply {
  return {
    text: `Encontré una carpeta muy parecida.\n\nSolicitada: ${requestedName}\nExistente: ${existingName}\n\n¿Quieres usar la existente o crear una nueva?`,
    replyMarkup: buildFolderConflictKeyboard(existingName, requestedName),
  };
}
