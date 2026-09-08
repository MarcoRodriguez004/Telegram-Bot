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
  return value.text === undefined || typeof value.text === "string";
}

function isChatType(value: unknown): value is TelegramChat["type"] {
  return value === "private" || value === "group" || value === "supergroup" || value === "channel";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
