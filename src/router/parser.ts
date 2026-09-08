import type { Intent } from "./intent";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TASK_TITLE_LENGTH = 500;
const TASK_COMMAND = /^(?:\/)?(?:tarea|pendiente)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/iu;

export function parseIntent(text: string): Intent {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized || normalized.length > MAX_MESSAGE_LENGTH) {
    return { action: "unknown", reason: "unsupported_message" };
  }

  const taskMatch = TASK_COMMAND.exec(normalized);
  if (!taskMatch) {
    return { action: "unknown", reason: "unsupported_message" };
  }

  const title = taskMatch[1]?.trim() ?? "";
  if (!title) {
    return { action: "unknown", reason: "missing_task_title" };
  }

  if (title.length > MAX_TASK_TITLE_LENGTH) {
    return { action: "unknown", reason: "task_title_too_long" };
  }

  return { action: "create_task", title };
}
