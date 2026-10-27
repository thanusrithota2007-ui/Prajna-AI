"""
Evaluation history in Zetaris Lightning: three fixed statement shapes, nothing else.

  1. CREATE TABLE IF NOT EXISTS <table> (...)                      -- exact constant
  2. INSERT INTO <table> VALUES (...)                              -- one row
  3. SELECT <columns> FROM <table> WHERE user_id = '<id>' ORDER BY created_at DESC LIMIT <n>

Safety model (the JDBC layer has no parameter binding, so we do not pretend it does):
  * every value is validated against a strict character class BEFORE it reaches the SQL text;
  * free text (question, answer) is base64-encoded, so it can never contain a quote or a keyword;
  * each statement must FULL-MATCH a pattern built from those same classes, otherwise the JDBC layer
    refuses it, so a validation bug here still cannot produce a different statement;
  * callers pass typed values, never SQL; no API caller can reach `allowed` or the table name.

Statements are never logged or returned (they contain student text, even if encoded).
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from app.integrations.zetaris_jdbc import QueryResult, _settings_kwargs, execute_statement

logger = logging.getLogger(__name__)

_TABLE_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,7}")
_EVAL_ID = r"[0-9a-f]{16}"
_USER_ID = r"[A-Za-z0-9_.@-]{1,64}"
_TIMESTAMP = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"
_B64 = r"[A-Za-z0-9+/=]*"
_MODEL = r"[A-Za-z0-9_./:-]{1,100}"

MAX_TEXT_BYTES = 12_000  # question (<=2000 chars) + answer (<=8000 chars) fit comfortably
MAX_LIMIT = 100


class HistoryError(RuntimeError):
    """Storage is disabled, misconfigured, or Zetaris failed. Never carries SQL or student text."""


@dataclass(frozen=True)
class HistoryRecord:
    evaluation_id: str
    user_id: str
    question: str
    answer: str
    overall_score: float
    clarity_score: int
    depth_score: int
    language_score: int
    model: str
    created_at: str  # UTC, e.g. 2026-10-27T09:30:00Z

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class StoredEntry:
    evaluation_id: str
    user_id: str
    created_at: str
    overall_score: float
    clarity_score: int
    depth_score: int
    language_score: int
    question: str


# ------------------------------------------------------------------ validation
def validate_table(name: str) -> str:
    if not _TABLE_RE.fullmatch(name or ""):
        raise HistoryError("history table name is not a valid dotted identifier")
    return name


def validate_user_id(user_id: str) -> str:
    if not re.fullmatch(_USER_ID, user_id or ""):
        raise HistoryError("user id contains characters that are not allowed in stored history")
    return user_id


def _b64(text: str) -> str:
    raw = text.encode("utf-8")
    if len(raw) > MAX_TEXT_BYTES:
        raise HistoryError("text too long to store")
    return base64.b64encode(raw).decode("ascii")


def _unb64(value: str) -> str:
    try:
        return base64.b64decode(value, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise HistoryError("stored text is malformed") from exc


def _score(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10:
        raise HistoryError("criterion score must be an integer 0-10")
    return value


# ------------------------------------------------------------ statement builders
def create_table_sql(table: str) -> str:
    return (
        f"CREATE TABLE IF NOT EXISTS {validate_table(table)} ("
        "evaluation_id string, user_id string, created_at string, overall_score double, "
        "clarity_score int, depth_score int, language_score int, "
        "question_b64 string, answer_b64 string, model string)"
    )


def insert_sql(table: str, r: HistoryRecord) -> str:
    if not 0 <= r.overall_score <= 10 or r.overall_score != r.overall_score:
        raise HistoryError("overall score must be between 0 and 10")
    values = (
        f"'{_checked(_EVAL_ID, r.evaluation_id, 'evaluation id')}', "
        f"'{validate_user_id(r.user_id)}', "
        f"'{_checked(_TIMESTAMP, r.created_at, 'timestamp')}', "
        f"{r.overall_score:.1f}, {_score(r.clarity_score)}, {_score(r.depth_score)}, {_score(r.language_score)}, "
        f"'{_b64(r.question)}', '{_b64(r.answer)}', "
        f"'{_checked(_MODEL, r.model, 'model name')}'"
    )
    return f"INSERT INTO {validate_table(table)} VALUES ({values})"


_SELECT_COLUMNS = (
    "evaluation_id, user_id, created_at, overall_score, clarity_score, depth_score, language_score, question_b64"
)


def select_sql(table: str, user_id: str, limit: int) -> str:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
        raise HistoryError(f"limit must be an integer 1-{MAX_LIMIT}")
    return (
        f"SELECT {_SELECT_COLUMNS} FROM {validate_table(table)} "
        f"WHERE user_id = '{validate_user_id(user_id)}' ORDER BY created_at DESC LIMIT {limit}"
    )


def _checked(pattern: str, value: str, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise HistoryError(f"invalid {label}")
    return value


def create_pattern(table: str) -> "re.Pattern[str]":
    return re.compile(re.escape(create_table_sql(table)))


def insert_pattern(table: str) -> "re.Pattern[str]":
    return re.compile(
        rf"INSERT INTO {re.escape(validate_table(table))} VALUES "
        rf"\('{_EVAL_ID}', '{_USER_ID}', '{_TIMESTAMP}', \d{{1,2}}\.\d, \d{{1,2}}, \d{{1,2}}, \d{{1,2}}, "
        rf"'{_B64}', '{_B64}', '{_MODEL}'\)"
    )


def select_pattern(table: str) -> "re.Pattern[str]":
    return re.compile(
        rf"SELECT {re.escape(_SELECT_COLUMNS)} FROM {re.escape(validate_table(table))} "
        rf"WHERE user_id = '{_USER_ID}' ORDER BY created_at DESC LIMIT \d{{1,3}}"
    )


# --------------------------------------------------------------------- the store
Executor = Callable[[str, "re.Pattern[str]"], QueryResult]


def _default_executor(sql: str, allowed: "re.Pattern[str]") -> QueryResult:
    return execute_statement(sql, allowed=allowed, **_settings_kwargs())


class HistoryStore:
    def __init__(self, table: str, executor: Executor | None = None):
        self._table = validate_table(table)
        self._run = executor or _default_executor
        self._ready = False

    def _execute(self, sql: str, pattern: "re.Pattern[str]", what: str) -> QueryResult:
        try:
            result = self._run(sql, pattern)
        except HistoryError:
            raise
        except Exception as exc:  # noqa: BLE001 - JVM/driver/permission errors; never echo them
            logger.warning("Zetaris history %s failed: %s", what, type(exc).__name__)
            raise HistoryError(f"Zetaris {what} failed") from exc
        if not result.ok:
            logger.warning("Zetaris history %s returned an error", what)
            raise HistoryError(f"Zetaris {what} failed")
        return result

    def ensure_table(self) -> None:
        if self._ready:
            return
        self._execute(create_table_sql(self._table), create_pattern(self._table), "table setup")
        self._ready = True

    def save(self, record: HistoryRecord) -> None:
        sql = insert_sql(self._table, record)  # validates everything first; raises HistoryError
        self.ensure_table()
        self._execute(sql, insert_pattern(self._table), "write")

    def list_for_user(self, user_id: str, limit: int = 20) -> list[StoredEntry]:
        sql = select_sql(self._table, user_id, limit)
        result = self._execute(sql, select_pattern(self._table), "read")
        entries: list[StoredEntry] = []
        for row in result.rows:
            try:
                entry = _entry_from_row(row)
                if entry.user_id != user_id:  # defence in depth: the WHERE clause should already guarantee this
                    logger.warning("Dropping a history row that does not belong to the requested user")
                    continue
                entries.append(entry)
            except (HistoryError, ValueError, IndexError, TypeError):
                logger.warning("Skipping a malformed history row")
        return entries


def _num(value: Any) -> float:
    return float(str(value))


def _entry_from_row(row: list[Any]) -> StoredEntry:
    owner = str(row[1])
    return StoredEntry(
        evaluation_id=str(row[0]),
        user_id=owner,
        created_at=str(row[2]),
        overall_score=_num(row[3]),
        clarity_score=int(_num(row[4])),
        depth_score=int(_num(row[5])),
        language_score=int(_num(row[6])),
        question=_unb64(str(row[7])),
    )
