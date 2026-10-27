"""
Zetaris Lightning JDBC client.

Design rules (milestone 1 — read-only metadata discovery):
  - One SQL statement per execute() call (Lightning dialect requirement).
  - All statements are validated against an explicit allowlist before execution.
  - No raw SQL from callers accepted — only named constants defined here.
  - Connections carry a hard timeout enforced by a threading.Timer.
  - JPype JVM is started lazily at first use; subsequent calls reuse it.

Do NOT add INSERT/UPDATE/DELETE/DDL or free-form query execution here until
a later milestone explicitly approves it.

Milestone 2 (evaluation history): callers may pass ``allowed``, a compiled regex that the
WHOLE statement must match. It is supplied by a vetted module that builds statements from
validated values (see zetaris_history.py); API callers can never supply it. Multi-statement
text (";") is rejected for every statement, and non-discovery SQL is redacted in logs/results
because it can carry student text.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Generator, List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowlisted discovery statements (one per Lightning category).
# Keys are stable names used by callers; values are the exact SQL strings.
# ---------------------------------------------------------------------------
DISCOVERY_STATEMENTS: dict[str, str] = {
    "select_1": "SELECT 1",
    "server_version": "SHOW SERVER VERSION",
    "show_schema": "SHOW SCHEMA",
    "show_lightning_databases": "SHOW LIGHTNING DATABASES",
    "show_datasources": "SHOW DATASOURCES",
}

# Template — caller substitutes {db_name}; validated below.
_SHOW_TABLES_TEMPLATE = "SHOW LIGHTNING TABLES {db_name}"
_DESCRIBE_TABLE_TEMPLATE = "DESCRIBE DATASOURCE TABLE {db_name}.{table_name}"

_ALLOWED_PREFIXES = frozenset([
    "SELECT 1",
    "SHOW SERVER VERSION",
    "SHOW SCHEMA",
    "SHOW LIGHTNING DATABASES",
    "SHOW DATASOURCES",
    "SHOW LIGHTNING TABLES ",
    "DESCRIBE DATASOURCE TABLE ",
])

# ---------------------------------------------------------------------------
# JVM lifecycle (module-level singleton)
# ---------------------------------------------------------------------------
_jvm_lock = threading.Lock()
_jvm_started = False


def _ensure_jvm(java_home: str, jar_path: str) -> None:
    """Start the JPype JVM exactly once per process."""
    global _jvm_started
    if _jvm_started:
        return
    with _jvm_lock:
        if _jvm_started:
            return  # double-checked

        try:
            import jpype  # type: ignore
            import jpype.imports  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "JPype1 is not installed. "
                "Run: pip install jpype1  (requires Python ≤3.13)"
            ) from exc

        jvm_dll = _find_jvm_dll(java_home)
        logger.info("Starting JVM: jvm_dll=%s jar=%s", jvm_dll, jar_path)
        jpype.startJVM(
            jvm_dll,
            f"-Djava.class.path={jar_path}",
            convertStrings=False,
        )
        _jvm_started = True
        logger.info("JVM started successfully")


def _find_jvm_dll(java_home: str) -> str:
    """Locate server/jvm.dll (Windows) or libjvm.so (Linux/macOS)."""
    candidates = [
        Path(java_home) / "bin" / "server" / "jvm.dll",    # Windows
        Path(java_home) / "lib" / "server" / "libjvm.so",   # Linux
        Path(java_home) / "lib" / "server" / "libjvm.dylib", # macOS
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    # Fall back to jpype auto-detection
    logger.warning(
        "Could not find JVM DLL under JAVA_HOME=%s; letting JPype auto-detect", java_home
    )
    return ""


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------
@dataclass
class QueryResult:
    statement: str
    columns: List[str] = field(default_factory=list)
    rows: List[List[Any]] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------
def _validate_identifier(value: str, label: str) -> str:
    """
    Reject anything that looks like SQL injection or an unusual identifier.
    Only alphanumeric, underscore, and hyphen are permitted.
    """
    import re
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", value):
        raise ValueError(
            f"Invalid {label} identifier {value!r}: "
            "only letters, digits, underscores, and hyphens are allowed"
        )
    return value


def _redact(sql: str) -> str:
    """Discovery statements are constants and safe to log; anything else may carry user text."""
    stripped = sql.strip()
    if any(stripped.upper().startswith(p.upper()) for p in _ALLOWED_PREFIXES):
        return sql
    return f"{stripped[:40]}...[redacted, {len(stripped)} chars]"


def _validate_statement(sql: str, allowed: "re.Pattern[str] | None" = None) -> None:
    """
    Raise unless *sql* is a single allowlisted statement: either it starts with a discovery
    prefix, or the whole text fully matches the ``allowed`` pattern supplied by a vetted module.
    """
    stripped = sql.strip()
    if ";" in stripped:
        raise PermissionError("Statement not in allowlist: multiple statements are not permitted.")
    upper = stripped.upper()
    for prefix in _ALLOWED_PREFIXES:
        if upper.startswith(prefix.upper()):
            return
    if allowed is not None and allowed.fullmatch(stripped):
        return
    raise PermissionError(
        f"Statement not in allowlist: {_redact(sql)!r}. "
        "Only predefined statements may be executed."
    )


# ---------------------------------------------------------------------------
# Connection context manager
# ---------------------------------------------------------------------------
@contextmanager
def _jdbc_connection(
    url: str,
    user: str,
    password: str,
    jar_path: str,
    driver_class: str,
    java_home: str,
    timeout_s: int,
) -> Generator[Any, None, None]:
    """
    Yield a live JayDeBeApi connection; close it on exit.
    Raises RuntimeError if the connect does not complete within *timeout_s*.
    """
    import jaydebeapi  # type: ignore

    _ensure_jvm(java_home, jar_path)

    conn: Any = None
    connect_error: list[Exception] = []
    connect_done = threading.Event()

    def _do_connect() -> None:
        try:
            conn_inner = jaydebeapi.connect(
                driver_class,
                url,
                [user, password],
                jar_path,
            )
            nonlocal conn
            conn = conn_inner
        except Exception as exc:  # noqa: BLE001
            connect_error.append(exc)
        finally:
            connect_done.set()

    t = threading.Thread(target=_do_connect, daemon=True)
    t.start()
    completed = connect_done.wait(timeout=timeout_s)

    if not completed:
        raise TimeoutError(
            f"JDBC connect to {url} timed out after {timeout_s}s"
        )
    if connect_error:
        raise connect_error[0]

    try:
        yield conn
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# Public execute interface
# ---------------------------------------------------------------------------
def execute_statement(
    sql: str,
    url: str,
    user: str,
    password: str,
    jar_path: str,
    driver_class: str,
    java_home: str,
    connect_timeout_s: int = 15,
    query_timeout_s: int = 30,
    allowed: "re.Pattern[str] | None" = None,
) -> QueryResult:
    """
    Execute *exactly one* allowlisted SQL statement and return a QueryResult.

    ``allowed`` (optional) is a full-match pattern from a vetted module; see _validate_statement.

    Never raises; errors are captured in QueryResult.error so the health
    endpoint can return a structured response regardless of driver behaviour.
    """
    _validate_statement(sql, allowed)
    safe_sql = _redact(sql)  # what may appear in logs / results

    try:
        with _jdbc_connection(
            url=url,
            user=user,
            password=password,
            jar_path=jar_path,
            driver_class=driver_class,
            java_home=java_home,
            timeout_s=connect_timeout_s,
        ) as conn:
            curs = conn.cursor()

            # Per-query timeout via a daemon thread
            query_error: list[Exception] = []
            query_rows: list[list[Any]] = []
            query_cols: list[str] = []
            query_done = threading.Event()

            def _do_query() -> None:
                try:
                    curs.execute(sql)
                    if curs.description:
                        query_cols.extend(
                            col[0] for col in curs.description
                        )
                        query_rows.extend(list(row) for row in curs.fetchall())
                except Exception as exc:  # noqa: BLE001
                    query_error.append(exc)
                finally:
                    query_done.set()

            qt = threading.Thread(target=_do_query, daemon=True)
            qt.start()
            finished = query_done.wait(timeout=query_timeout_s)

            if not finished:
                return QueryResult(
                    statement=safe_sql,
                    error=f"Query timed out after {query_timeout_s}s",
                )
            if query_error:
                err_msg = str(query_error[0])
                logger.warning("Statement %r raised: %s", safe_sql, type(query_error[0]).__name__)
                return QueryResult(statement=safe_sql, error=err_msg)

            return QueryResult(
                statement=safe_sql,
                columns=query_cols,
                rows=query_rows,
            )

    except Exception as exc:  # noqa: BLE001
        logger.warning("execute_statement failed for %r: %s", safe_sql, type(exc).__name__)
        return QueryResult(statement=safe_sql, error=str(exc))


# ---------------------------------------------------------------------------
# High-level discovery helpers (used by the health endpoint)
# ---------------------------------------------------------------------------

def _settings_kwargs() -> dict[str, Any]:
    """Pull connection params from the centralised settings object."""
    from app.core.config import settings  # late import to avoid circular dep

    return dict(
        url=settings.zetaris_jdbc_url,
        user=settings.zetaris_user,
        password=settings.effective_password,
        jar_path=settings.zetaris_jar_path,
        driver_class=settings.zetaris_driver_class,
        java_home=settings.java_home,
        connect_timeout_s=settings.jdbc_connect_timeout_s,
        query_timeout_s=settings.jdbc_query_timeout_s,
    )


def run_discovery() -> dict[str, Any]:
    """
    Execute the full read-only probe sequence and return a structured dict.

    Probe order mirrors the spec:
      1. SELECT 1
      2. SHOW SERVER VERSION
      3. SHOW SCHEMA
      4. SHOW LIGHTNING DATABASES
      5. SHOW DATASOURCES
      6. SHOW LIGHTNING TABLES <name>  for each discovered database
    """
    kw = _settings_kwargs()
    result: dict[str, Any] = {}

    # Step 1–5: fixed statements
    for key, sql in DISCOVERY_STATEMENTS.items():
        qr = execute_statement(sql, **kw)
        result[key] = _serialize_result(qr)

    # Step 6: per-database tables
    db_result = result.get("show_lightning_databases", {})
    db_rows = db_result.get("rows", [])
    tables_by_db: dict[str, Any] = {}

    for row in db_rows:
        # The first column is expected to be the database name.
        db_name_raw = row[0] if row else None
        if not db_name_raw:
            continue
        db_name = str(db_name_raw).strip()
        try:
            _validate_identifier(db_name, "database name")
        except ValueError as exc:
            tables_by_db[db_name] = {"error": str(exc)}
            continue

        sql_tables = _SHOW_TABLES_TEMPLATE.format(db_name=db_name)
        qr = execute_statement(sql_tables, **kw)
        tables_by_db[db_name] = _serialize_result(qr)

    result["show_lightning_tables"] = tables_by_db
    return result


def _serialize_result(qr: QueryResult) -> dict[str, Any]:
    """Convert a QueryResult to a JSON-safe dict."""
    if not qr.ok:
        return {"ok": False, "error": qr.error, "statement": qr.statement}
    return {
        "ok": True,
        "statement": qr.statement,
        "columns": qr.columns,
        "rows": [[_coerce(v) for v in row] for row in qr.rows],
        "row_count": len(qr.rows),
    }


def _coerce(value: Any) -> Any:
    """Convert Java / JDBC types to Python-native JSON-safe values."""
    if value is None:
        return None
    # JPype wraps Java strings — str() unwraps them
    try:
        from jpype import JString  # type: ignore
        if isinstance(value, JString):
            return str(value)
    except Exception:  # noqa: BLE001
        pass
    if isinstance(value, (int, float, bool, str)):
        return value
    return str(value)
