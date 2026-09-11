export type Intent =
  | { action: "create_task"; title: string; dueAt?: string | null }
  | { action: "list_tasks"; filter?: "pending" | "completed" | "cancelled" | "all" }
  | { action: "create_reminder"; title: string; remindAt: string }
  | { action: "list_reminders"; filter?: "pending" | "completed" | "cancelled" | "all" }
  | { action: "create_expense"; amountCents: number; currency: string; category: string; description?: string }
  | { action: "list_expenses"; category?: string; range: "all" }
  | { action: "create_folder"; name: string }
  | { action: "list_folders"; kind?: "all" | "photos" | "documents" | "links" }
  | { action: "save_note"; content: string; url?: string; folderName?: string }
  | { action: "list_notes"; beforeId?: number; kind?: "all" | "photos" | "documents" | "links"; folderId?: number | null; folderName?: string }
  | { action: "get_note"; noteId: number }
  | { action: "summary"; range: "today" | "week" | "month" }
  | { action: "delete_data"; confirmation: true }
  | { action: "reply"; message: string }
  | { action: "clarify"; question: string; missing: string[]; suggestedText?: string }
  | { action: "unknown"; reason: string };
