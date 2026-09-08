import unittest
from datetime import datetime, timezone

from app.database import Database


class DatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.database = Database(":memory:")
        self.database.initialize()

    def tearDown(self) -> None:
        self.database.close()

    def test_persists_expense_link_and_task(self) -> None:
        expense_id = self.database.add_expense(45_000, "MXN", "gasolina", None)
        link_id = self.database.add_link("https://example.com", "leer después")
        task_id = self.database.add_task("comprar medicina")

        self.assertEqual(self.database.list_expenses()[0].id, expense_id)
        self.assertEqual(self.database.list_expenses()[0].amount_cents, 45_000)
        self.assertEqual(self.database.list_links()[0].id, link_id)
        self.assertEqual(self.database.list_tasks()[0].title, "comprar medicina")
        self.assertEqual(self.database.list_tasks()[0].id, task_id)

    def test_pending_reminder_survives_and_can_be_marked_sent(self) -> None:
        due_at = datetime(2026, 9, 8, 15, 0, tzinfo=timezone.utc)
        reminder_id = self.database.add_reminder("pagar internet", due_at)

        pending = self.database.list_pending_reminders()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].id, reminder_id)
        self.assertEqual(pending[0].due_at, due_at)

        self.database.mark_reminder_sent(reminder_id, datetime(2026, 9, 8, 15, 1, tzinfo=timezone.utc))

        self.assertEqual(self.database.list_pending_reminders(), [])

    def test_claim_update_is_idempotent(self) -> None:
        self.assertTrue(self.database.claim_update(123))
        self.assertFalse(self.database.claim_update(123))

    def test_delete_all_removes_personal_records(self) -> None:
        self.database.add_task("borrar después")
        self.database.add_link("https://example.com", None)

        self.database.delete_all()

        self.assertEqual(self.database.list_tasks(), [])
        self.assertEqual(self.database.list_links(), [])


if __name__ == "__main__":
    unittest.main()
