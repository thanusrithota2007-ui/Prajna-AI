"""
Live check of evaluation-history storage against YOUR running Zetaris. Run from the backend folder:

    python scripts/zetaris_history_probe.py

It uses only synthetic data (user id 'zz-probe-...'), never real student text, so its output is safe to share.
Credentials are read from the same settings as the app (.env) and are never printed.

Steps (each reported separately, so a failure points at the exact capability that is missing):
  1. connect     : SELECT 1
  2. create      : CREATE TABLE IF NOT EXISTS <ZETARIS_HISTORY_TABLE>
  3. insert      : INSERT one synthetic row (INCLUDING a quote, backslash and unicode in the text)
  4. read back   : SELECT it again for that probe user and compare every field
  5. scoping     : SELECT for a different user returns nothing

NOTE: the app has no DELETE, so the probe row stays in the table. It is clearly labelled and harmless.
"""

from __future__ import annotations

import secrets
import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.integrations import zetaris_jdbc  # noqa: E402
from app.integrations.zetaris_history import HistoryRecord, HistoryStore, QueryResult  # noqa: E402

SETUP_HINT = """
If step 2 failed, the table's namespace probably does not exist yet. In your Zetaris SQL console, using the
syntax from the Lightning docs (zetaris/lightning-catalog, doc/doc/lightning-commands.md), something like:

  CREATE NAMESPACE lightning.datasource.iceberg;
  REGISTER OR REPLACE ICEBERG DATASOURCE icebergdb OPTIONS(type "hadoop", warehouse "/path/in/container") NAMESPACE lightning.datasource.iceberg;
  CREATE NAMESPACE lightning.datasource.iceberg.icebergdb.upsc;

Then set ZETARIS_HISTORY_TABLE to a table inside that namespace (default: lightning.datasource.iceberg.icebergdb.upsc.evaluations).
Use a warehouse path on a mounted Docker volume if you want the data to survive container re-creation.
These statements come from the open-source docs and are NOT verified against your instance.
""".strip()

Executor = Callable[[str, "object"], QueryResult]


def run_probe(table: str, executor: Executor, say: Callable[[str], None] = print) -> bool:
    """Returns True only if every step succeeded. `executor(sql, allowed_pattern) -> QueryResult`."""
    last_error: list[str] = []

    def capturing(sql: str, allowed):  # keep the driver's own message: the probe data is synthetic
        qr = executor(sql, allowed)
        if not qr.ok:
            last_error.append(str(qr.error)[:300])
        return qr

    probe_user = f"zz-probe-{secrets.token_hex(3)}"
    text = "Probe: it's a \"test\" \\ with unicode \u00e9\u4e2d and a newline\nok"
    record = HistoryRecord(
        evaluation_id=secrets.token_hex(8), user_id=probe_user, question=text, answer=text + " answer", overall_score=6.3,
        clarity_score=7, depth_score=4, language_score=8, model="probe/model", created_at=HistoryRecord.now(),
    )
    ok = True

    def step(name: str, fn: Callable[[], str | None]) -> bool:
        nonlocal ok
        last_error.clear()
        try:
            detail = fn()
            say(f"[PASS] {name}" + (f" - {detail}" if detail else ""))
            return True
        except Exception as exc:  # noqa: BLE001
            ok = False
            say(f"[FAIL] {name} - {type(exc).__name__}" + (f": {last_error[-1]}" if last_error else ""))
            return False

    store = HistoryStore(table, capturing)
    step("1 connect (SELECT 1)", lambda: _select_one(executor))
    created = step("2 create table (IF NOT EXISTS)", store.ensure_table)
    if not created:
        say("\n" + SETUP_HINT)
        return False
    if not step("3 insert one row", lambda: store.save(record)):
        return False

    def read_back() -> str:
        rows = store.list_for_user(probe_user, 5)
        if len(rows) != 1:
            raise AssertionError(f"expected 1 row, got {len(rows)}")
        r = rows[0]
        want = (record.evaluation_id, record.overall_score, record.clarity_score, record.depth_score, record.language_score, record.question)
        got = (r.evaluation_id, r.overall_score, r.clarity_score, r.depth_score, r.language_score, r.question)
        if got != want:
            raise AssertionError(f"round trip mismatch in fields {[i for i, (a, b) in enumerate(zip(got, want)) if a != b]}")
        return "all fields round-tripped, including quote/backslash/unicode text"

    step("4 read back", read_back)
    step("5 user scoping", lambda: _scoping(store, probe_user))
    return ok


def _select_one(executor) -> str:
    qr = executor("SELECT 1", None)
    if not qr.ok:
        raise RuntimeError(qr.error)
    return "connected"


def _scoping(store: HistoryStore, probe_user: str) -> str:
    other = store.list_for_user(f"{probe_user}-other", 5)
    if other:
        raise AssertionError("a different user id returned rows")
    return "a different user sees nothing"


def _live_executor(sql: str, allowed):
    return zetaris_jdbc.execute_statement(sql, allowed=allowed, **zetaris_jdbc._settings_kwargs())  # noqa: SLF001


def main() -> int:
    from app.core.config import settings

    print(f"Table: {settings.zetaris_history_table}")
    print(f"ZETARIS_HISTORY_ENABLED: {settings.zetaris_history_enabled} (the probe works regardless; the app needs it true)\n")
    passed = run_probe(settings.zetaris_history_table, _live_executor)
    print("\nRESULT: " + ("all steps passed - live writes and reads work" if passed else "NOT all steps passed - history storage is not verified"))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
