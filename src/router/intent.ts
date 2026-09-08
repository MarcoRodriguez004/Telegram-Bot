export type Intent =
  | { action: "create_task"; title: string }
  | { action: "create_reminder"; title: string; remindAt: string }
  | { action: "create_expense"; amountCents: number; currency: string; category: string; description?: string }
  | { action: "save_note"; content: string; url?: string }
  | { action: "summary"; range: "today" | "week" | "month" }
  | { action: "unknown"; reason: string };
