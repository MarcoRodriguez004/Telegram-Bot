export type Intent =
  | { action: "create_task"; title: string; dueAt?: string | null }
  | { action: "list_tasks"; filter?: "pending" | "completed" | "cancelled" | "all" }
  | { action: "create_reminder"; title: string; remindAt: string }
  | { action: "list_reminders"; filter?: "pending" | "completed" | "cancelled" | "all" }
  | { action: "create_expense"; amountCents: number; currency: string; category: string; description?: string }
  | { action: "list_expenses"; category?: string; range: "all" }
  | { action: "save_note"; content: string; url?: string }
  | { action: "list_notes"; beforeId?: number; kind?: "all" | "photos" | "documents" }
  | { action: "get_note"; noteId: number }
  | { action: "summary"; range: "today" | "week" | "month" }
  | { action: "delete_data"; confirmation: true }
  | { action: "reply"; message: string }
  | { action: "clarify"; question: string; missing: string[]; suggestedText?: string }
  | { action: "unknown"; reason: string };
