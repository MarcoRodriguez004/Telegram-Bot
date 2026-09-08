from __future__ import annotations

import re
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Action(str, Enum):
    EXPENSE = "expense"
    REMINDER = "reminder"
    LINK = "link"
    TASK = "task"
    UNKNOWN = "unknown"


class Intent(BaseModel):
    """Closed contract between a classifier and the action executor."""

    model_config = ConfigDict(extra="forbid")

    action: Action
    amount_cents: int | None = Field(default=None, ge=1, le=100_000_000)
    currency: str = Field(default="MXN", min_length=3, max_length=3)
    title: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1_000)
    url: str | None = Field(default=None, max_length=2_048)
    due_at: datetime | None = None

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("currency must be a three-letter ISO code")
        return value

    @field_validator("title", "note")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().rstrip(".,;:!?)]}")
        if not re.fullmatch(r"https?://[^\s<>]+", value, flags=re.IGNORECASE):
            raise ValueError("url must use http or https")
        return value

    @field_validator("due_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("due_at must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_action_payload(self) -> Intent:
        if self.action == Action.EXPENSE and (self.amount_cents is None or not self.title):
            raise ValueError("an expense requires amount_cents and title")
        if self.action == Action.REMINDER and (not self.title or self.due_at is None):
            raise ValueError("a reminder requires title and due_at")
        if self.action == Action.LINK and not self.url:
            raise ValueError("a link requires url")
        if self.action == Action.TASK and not self.title:
            raise ValueError("a task requires title")
        return self


_URL_RE = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)
_EXPENSE_PREFIX_RE = re.compile(
    r"^(?:gasto|gast[eé]|registrar\s+gasto|registra\s+gasto|apunta(?:me)?|anota)\b",
    re.IGNORECASE,
)
_REMINDER_PREFIX_RE = re.compile(
    r"^(?:recu[eé]rdame(?:\s+que)?|recordatorio(?:\s+de)?|av[ií]same(?:\s+de\s+que)?)\s+",
    re.IGNORECASE,
)
_TASK_PREFIX_RE = re.compile(r"^(?:tarea|pendiente)\s+", re.IGNORECASE)
_AMOUNT_RE = re.compile(
    r"^\s*(?:\$\s*|mxn\s*)?(?P<number>\d[\d.,]*)(?:\s*(?:mxn|pesos?))?\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
_TIME_RE = r"(?:\s+a\s+las?\s+(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?)?"


def parse_local(
    text: str,
    *,
    now: datetime | None = None,
    timezone_name: str = "America/Mexico_City",
) -> Intent:
    """Parse the deliberately small local-language fallback parser."""

    text = text.strip()
    if not text or len(text) > 4_000:
        return Intent(action=Action.UNKNOWN)

    timezone = ZoneInfo(timezone_name)
    current = now or datetime.now(timezone)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone)
    normalized = re.sub(r"\s+", " ", text)

    link_intent = _parse_link(normalized)
    if link_intent:
        return link_intent

    expense_intent = _parse_expense(normalized)
    if expense_intent:
        return expense_intent

    reminder_intent = _parse_reminder(normalized, current, timezone)
    if reminder_intent:
        return reminder_intent

    task_intent = _parse_task(normalized)
    if task_intent:
        return task_intent

    return Intent(action=Action.UNKNOWN)


def _parse_link(text: str) -> Intent | None:
    url_match = _URL_RE.search(text)
    if not url_match or not re.match(r"^(?:guardar|guarda|enlace|link)\b", text, re.IGNORECASE):
        return None
    url = url_match.group(0).rstrip(".,;:!?)]}")
    before = text[: url_match.start()]
    after = text[url_match.end() :]
    note = re.sub(r"^(?:guardar|guarda|este\s+link|este\s+enlace)\s*", "", before, flags=re.IGNORECASE)
    note = f"{note} {after}".strip(" -") or None
    try:
        return Intent(action=Action.LINK, url=url, note=note)
    except ValueError:
        return None


def _parse_expense(text: str) -> Intent | None:
    prefix = _EXPENSE_PREFIX_RE.match(text)
    if not prefix:
        return None
    remainder = text[prefix.end() :].strip()
    amount_match = _AMOUNT_RE.match(remainder)
    if not amount_match:
        return None
    try:
        amount_cents = _amount_to_cents(amount_match.group("number"))
    except ValueError:
        return None
    title = amount_match.group("rest").strip(" -:;")
    title = re.sub(r"^(?:en|de|por)\s+", "", title, flags=re.IGNORECASE).strip()
    if not title:
        return None
    try:
        return Intent(action=Action.EXPENSE, amount_cents=amount_cents, title=title)
    except ValueError:
        return None


def _parse_reminder(text: str, now: datetime, timezone: ZoneInfo) -> Intent | None:
    prefix = _REMINDER_PREFIX_RE.match(text)
    if not prefix:
        return None
    payload = text[prefix.end() :].strip()
    due_at, title = _extract_due(payload, now, timezone)
    if due_at is None or not title:
        return None
    try:
        return Intent(action=Action.REMINDER, title=title, due_at=due_at)
    except ValueError:
        return None


def _parse_task(text: str) -> Intent | None:
    prefix = _TASK_PREFIX_RE.match(text)
    if not prefix:
        return None
    title = text[prefix.end() :].strip(" -:;")
    if not title:
        return None
    try:
        return Intent(action=Action.TASK, title=title)
    except ValueError:
        return None


def _extract_due(payload: str, now: datetime, timezone: ZoneInfo) -> tuple[datetime | None, str]:
    relative_match = re.search(
        rf"\s+(?P<day>hoy|ma[ñn]ana){_TIME_RE}$",
        payload,
        flags=re.IGNORECASE,
    )
    if relative_match:
        hour = int(relative_match.group("hour") or 9)
        minute = int(relative_match.group("minute") or 0)
        if hour > 23 or minute > 59:
            return None, ""
        base = now + timedelta(days=1 if relative_match.group("day").lower().replace("ñ", "n") == "manana" else 0)
        due_at = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return due_at, payload[: relative_match.start()].strip(" -:;")

    in_match = re.search(r"\s+en\s+(?P<count>\d+)\s+(?P<unit>minutos?|horas?)$", payload, flags=re.IGNORECASE)
    if in_match:
        count = int(in_match.group("count"))
        unit = in_match.group("unit").lower()
        delta = timedelta(minutes=count if unit.startswith("min") else count * 60)
        return now + delta, payload[: in_match.start()].strip(" -:;")

    return None, ""


def _amount_to_cents(number: str) -> int:
    if "," in number and "." in number:
        decimal_separator = "," if number.rfind(",") > number.rfind(".") else "."
        thousands_separator = "." if decimal_separator == "," else ","
        normalized = number.replace(thousands_separator, "").replace(decimal_separator, ".")
    elif "," in number or "." in number:
        separator = "," if "," in number else "."
        left, right = number.rsplit(separator, 1)
        normalized = number.replace(separator, "") if len(right) == 3 and left else number.replace(",", ".")
    else:
        normalized = number
    try:
        major, _, minor = normalized.partition(".")
        if not major.isdigit() or (minor and not minor.isdigit()) or len(minor) > 2:
            raise ValueError
        return int(major) * 100 + int((minor or "0").ljust(2, "0"))
    except (ValueError, TypeError):
        raise ValueError("invalid amount") from None

