"""The live probe, exercised against an in-memory stand-in for Zetaris that parses our own statements."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

from app.integrations.zetaris_jdbc import QueryResult

_spec = importlib.util.spec_from_file_location("probe", Path(__file__).resolve().parents[2] / "scripts" / "zetaris_history_probe.py")
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)  # type: ignore[union-attr]

TABLE = "lightning.datasource.iceberg.icebergdb.upsc.evaluations"


class InMemoryZetaris:
    """Understands exactly the three statement shapes we send. Returns numbers as Java-ish strings/floats."""

    def __init__(self, *, fail_on: str | None = None, create_error: str | None = None):
        self.rows: list[list] = []
        self.fail_on, self.create_error = fail_on, create_error
        self.seen: list[str] = []

    def __call__(self, sql, allowed):
        self.seen.append(sql.split(" ", 1)[0])
        if allowed is not None:
            assert allowed.fullmatch(sql), "statement not accepted by its own allowlist pattern"
        if sql == "SELECT 1":
            return QueryResult(statement=sql, columns=["1"], rows=[[1]])
        if sql.startswith("CREATE TABLE"):
            return QueryResult(statement=sql, error=self.create_error) if self.create_error else QueryResult(statement=sql)
        if sql.startswith("INSERT") and self.fail_on == "insert":
            return QueryResult(statement=sql, error="insert unsupported")
        if sql.startswith("INSERT"):
            v = re.findall(r"'([^']*)'|(\d+(?:\.\d+)?)", sql.split("VALUES", 1)[1])
            vals = [a if a != "" or b == "" else b for a, b in v]
            self.rows.append([vals[0], vals[1], vals[2], float(vals[3]), int(vals[4]), int(vals[5]), int(vals[6]), vals[7], vals[8]])
            return QueryResult(statement=sql)
        if sql.startswith("SELECT"):
            user = re.search(r"user_id = '([^']*)'", sql).group(1)
            return QueryResult(statement=sql, rows=[[r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]] for r in self.rows if r[1] == user])
        raise AssertionError(f"unexpected statement {sql[:30]}")


def test_probe_passes_end_to_end_and_round_trips_hostile_text():
    out: list[str] = []
    z = InMemoryZetaris()
    assert probe.run_probe(TABLE, z, out.append) is True
    assert [l.split("]")[0] for l in out] == ["[PASS"] * 5
    assert z.seen[:3] == ["SELECT", "CREATE", "INSERT"]


def test_probe_stops_and_prints_setup_help_when_the_table_cannot_be_created():
    out: list[str] = []
    assert probe.run_probe(TABLE, InMemoryZetaris(create_error="namespace not found"), out.append) is False
    text = "\n".join(out)
    assert "[FAIL] 2 create table" in text and "namespace not found" in text and "REGISTER OR REPLACE ICEBERG" in text
    assert "3 insert" not in text


def test_probe_reports_a_failed_insert_honestly():
    out: list[str] = []
    assert probe.run_probe(TABLE, InMemoryZetaris(fail_on="insert"), out.append) is False
    assert any(l.startswith("[FAIL] 3 insert") for l in out) and not any("4 read back" in l for l in out)
