import { describe, expect, it } from "vitest";
import { isAuthorizedUpdate } from "../src/telegram/auth";
import type { TelegramUpdate } from "../src/telegram/types";

function updateFor(userId: number, chatType: "private" | "group" = "private", isBot = false): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_757_000_000,
      chat: { id: userId, type: chatType },
      from: { id: userId, is_bot: isBot },
      text: "/start",
    },
  };
}

describe("Telegram update authorization", () => {
  it("accepts any real user in a private chat", () => {
    expect(isAuthorizedUpdate(updateFor(42))).toBe(true);
    expect(isAuthorizedUpdate(updateFor(99))).toBe(true);
  });

  it("rejects bots and group chats", () => {
    expect(isAuthorizedUpdate(updateFor(42, "private", true))).toBe(false);
    expect(isAuthorizedUpdate(updateFor(42, "group"))).toBe(false);
  });
});
