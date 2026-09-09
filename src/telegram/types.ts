export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
}

export interface TelegramAttachment {
  kind: "photo" | "document";
  fileId: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export function parseTelegramUpdate(input: unknown): TelegramUpdate | null {
  if (!isRecord(input)) {
    return null;
  }

  const updateId = input.update_id;
  if (typeof updateId !== "number" || !Number.isInteger(updateId) || updateId < 0) {
    return null;
  }

  if (input.message !== undefined && !isTelegramMessage(input.message)) {
    return null;
  }

  return {
    update_id: updateId,
    message: input.message as TelegramMessage | undefined,
  };
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isRecord(value) || !Number.isInteger(value.message_id) || !Number.isInteger(value.date)) {
    return false;
  }
  if (!isRecord(value.chat) || !Number.isInteger(value.chat.id) || !isChatType(value.chat.type)) {
    return false;
  }
  if (value.from !== undefined && (!isRecord(value.from) || !Number.isInteger(value.from.id))) {
    return false;
  }
  if (value.text !== undefined && typeof value.text !== "string") return false;
  if (value.caption !== undefined && typeof value.caption !== "string") return false;
  if (value.document !== undefined && (!isRecord(value.document) || !isTelegramFile(value.document) ||
    (value.document.file_name !== undefined && typeof value.document.file_name !== "string"))) return false;
  if (value.photo !== undefined && (!Array.isArray(value.photo) || value.photo.length === 0 ||
    !value.photo.every((photo) => isRecord(photo) && isTelegramFile(photo) &&
      typeof photo.width === "number" && Number.isSafeInteger(photo.width) && photo.width > 0 &&
      typeof photo.height === "number" && Number.isSafeInteger(photo.height) && photo.height > 0))) return false;
  return true;
}

function isTelegramFile(value: Record<string, unknown>): boolean {
  return isTelegramFileId(value.file_id) && typeof value.file_unique_id === "string" &&
    value.file_unique_id.length > 0 && value.file_unique_id.length <= 512;
}

export function isTelegramFileId(value: unknown): value is string {
  // Only accept opaque Telegram identifiers, never URLs or attach:// references.
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,512}$/.test(value);
}

function isChatType(value: unknown): value is TelegramChat["type"] {
  return value === "private" || value === "group" || value === "supergroup" || value === "channel";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
