import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from app.intents import Action, Intent, parse_local


class ParseLocalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 9, 7, 13, 30, tzinfo=ZoneInfo("America/Mexico_City"))

    def test_parses_expense_with_category(self) -> None:
        intent = parse_local("gasto 450 gasolina", now=self.now)

        self.assertEqual(intent.action, Action.EXPENSE)
        self.assertEqual(intent.amount_cents, 45_000)
        self.assertEqual(intent.currency, "MXN")
        self.assertEqual(intent.title, "gasolina")

    def test_parses_mexican_decimal_amount(self) -> None:
        intent = parse_local("gasto 1.250,50 supermercado", now=self.now)

        self.assertEqual(intent.amount_cents, 125_050)

    def test_parses_reminder_for_tomorrow_at_default_time(self) -> None:
        intent = parse_local("recuérdame pagar internet mañana", now=self.now)

        self.assertEqual(intent.action, Action.REMINDER)
        self.assertEqual(intent.title, "pagar internet")
        self.assertEqual(intent.due_at, datetime(2026, 9, 8, 9, 0, tzinfo=self.now.tzinfo))

    def test_parses_reminder_with_explicit_time(self) -> None:
        intent = parse_local("recuérdame llamar al médico mañana a las 18:30", now=self.now)

        self.assertEqual(intent.title, "llamar al médico")
        self.assertEqual(intent.due_at.hour, 18)
        self.assertEqual(intent.due_at.minute, 30)

    def test_parses_link_and_keeps_only_safe_schemes(self) -> None:
        intent = parse_local("guardar este link https://example.com/articulo.", now=self.now)

        self.assertEqual(intent.action, Action.LINK)
        self.assertEqual(intent.url, "https://example.com/articulo")

    def test_parses_task(self) -> None:
        intent = parse_local("tarea comprar medicina", now=self.now)

        self.assertEqual(intent.action, Action.TASK)
        self.assertEqual(intent.title, "comprar medicina")

    def test_unrecognized_message_is_safe_unknown(self) -> None:
        intent = parse_local("hola, ¿cómo estás?", now=self.now)

        self.assertEqual(intent.action, Action.UNKNOWN)


class IntentValidationTests(unittest.TestCase):
    def test_rejects_non_http_url(self) -> None:
        with self.assertRaises(ValueError):
            Intent(action=Action.LINK, url="file:///etc/passwd")

    def test_rejects_non_positive_expense(self) -> None:
        with self.assertRaises(ValueError):
            Intent(action=Action.EXPENSE, amount_cents=0, title="gasolina")


if __name__ == "__main__":
    unittest.main()
