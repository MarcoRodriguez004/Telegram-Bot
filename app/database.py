from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class ExpenseRecord:
    id: int
    amount_cents: int
    currency: str
    category: str
    note: str | None
    created_at: datetime


@dataclass(frozen=True)
class ReminderRecord:
    id: int
    title: str
    due_at: datetime
    created_at: datetime


@dataclass(frozen=True)
class LinkRecord:
    id: int
    url: str
    note: str | None
    created_at: datetime


@dataclass(frozen=True)
class TaskRecord:
    id: int
    title: str
    created_at: datetime


class Database:
    """Small SQLite repository for the single authorized user."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")

    def initialize(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_cents INTEGER NOT NULL,
                currency TEXT NOT NULL,
                category TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                due_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                sent_at TEXT
            );
            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS processed_updates (
                update_id INTEGER PRIMARY KEY,
                processed_at TEXT NOT NULL
            );
            """
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    def add_expense(
        self,
        amount_cents: int,
        currency: str,
        category: str,
        note: str | None,
        created_at: datetime | None = None,
    ) -> int:
        cursor = self.connection.execute(
            "INSERT INTO expenses (amount_cents, currency, category, note, created_at) VALUES (?, ?, ?, ?, ?)",
            (amount_cents, currency, category, note, _serialize_datetime(created_at)),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def list_expenses(self, limit: int = 20) -> list[ExpenseRecord]:
        rows = self.connection.execute(
            "SELECT id, amount_cents, currency, category, note, created_at "
            "FROM expenses ORDER BY created_at DESC, id DESC LIMIT ?",
            (max(1, min(limit, 100)),),
        ).fetchall()
        return [
            ExpenseRecord(
                id=row["id"],
                amount_cents=row["amount_cents"],
                currency=row["currency"],
                category=row["category"],
                note=row["note"],
                created_at=_deserialize_datetime(row["created_at"]),
            )
            for row in rows
        ]

    def add_reminder(self, title: str, due_at: datetime, created_at: datetime | None = None) -> int:
        cursor = self.connection.execute(
            "INSERT INTO reminders (title, due_at, created_at) VALUES (?, ?, ?)",
            (title, _serialize_datetime(due_at), _serialize_datetime(created_at)),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def list_pending_reminders(self) -> list[ReminderRecord]:
        rows = self.connection.execute(
            "SELECT id, title, due_at, created_at FROM reminders "
            "WHERE sent_at IS NULL ORDER BY due_at ASC, id ASC"
        ).fetchall()
        return [
            ReminderRecord(
                id=row["id"],
                title=row["title"],
                due_at=_deserialize_datetime(row["due_at"]),
                created_at=_deserialize_datetime(row["created_at"]),
            )
            for row in rows
        ]

    def mark_reminder_sent(self, reminder_id: int, sent_at: datetime | None = None) -> None:
        self.connection.execute(
            "UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL",
            (_serialize_datetime(sent_at), reminder_id),
        )
        self.connection.commit()

    def add_link(self, url: str, note: str | None, created_at: datetime | None = None) -> int:
        cursor = self.connection.execute(
            "INSERT INTO links (url, note, created_at) VALUES (?, ?, ?)",
            (url, note, _serialize_datetime(created_at)),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def list_links(self, limit: int = 20) -> list[LinkRecord]:
        rows = self.connection.execute(
            "SELECT id, url, note, created_at FROM links ORDER BY created_at DESC, id DESC LIMIT ?",
            (max(1, min(limit, 100)),),
        ).fetchall()
        return [
            LinkRecord(
                id=row["id"],
                url=row["url"],
                note=row["note"],
                created_at=_deserialize_datetime(row["created_at"]),
            )
            for row in rows
        ]

    def add_task(self, title: str, created_at: datetime | None = None) -> int:
        cursor = self.connection.execute(
            "INSERT INTO tasks (title, created_at) VALUES (?, ?)",
            (title, _serialize_datetime(created_at)),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def list_tasks(self, limit: int = 20) -> list[TaskRecord]:
        rows = self.connection.execute(
            "SELECT id, title, created_at FROM tasks "
            "WHERE completed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?",
            (max(1, min(limit, 100)),),
        ).fetchall()
        return [
            TaskRecord(
                id=row["id"],
                title=row["title"],
                created_at=_deserialize_datetime(row["created_at"]),
            )
            for row in rows
        ]

    def claim_update(self, update_id: int, processed_at: datetime | None = None) -> bool:
        cursor = self.connection.execute(
            "INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)",
            (update_id, _serialize_datetime(processed_at)),
        )
        self.connection.commit()
        return cursor.rowcount == 1

    def delete_all(self) -> None:
        self.connection.executescript(
            """
            DELETE FROM expenses;
            DELETE FROM reminders;
            DELETE FROM links;
            DELETE FROM tasks;
            DELETE FROM processed_updates;
            """
        )
        self.connection.commit()


def _serialize_datetime(value: datetime | None) -> str:
    moment = value or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        raise ValueError("datetime must include a timezone")
    return moment.astimezone(timezone.utc).isoformat()


def _deserialize_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)

