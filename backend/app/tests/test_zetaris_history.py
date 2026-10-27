"""Zetaris history storage: statement safety, scoping, failures and log hygiene. No live Zetaris needed."""

from __future__ import annotations

import base64
import logging
import re

import pytest

from app.integrations import zetaris_jdbc
from app.integrations.zetaris_history import (
    HistoryError,
    HistoryRecord,
    HistoryStore,
    create_pattern,
    create_table_sql,
    insert_pattern,
    insert_sql,
    select_pattern,
    select_sql,
    validate_table,
)
from app.integrations.zetaris_jdbc import QueryResult, _redact, _validate_statement

TABLE = "lightning.datasource.iceberg.icebergdb.upsc.evaluations"
HOSTILE = "it's \"quoted\"; DROP TABLE x; -- \\ \n ' OR '1'='1 \u00e9\u4e2d"


def rec(**over) -> HistoryRecord:
    base = dict(
        evaluation_id="0123456789abcdef", user_id="stu-1", question=HOSTILE, answer=HOSTILE * 3, overall_score=6.3,
        clarity_score=7, depth_score=4, language_score=8, model="meta/model-1", created_at="2026-10-27T09:30:00Z",
    )
    return HistoryRecord(**{**base, **over})


class FakeExecutor:
    def __init__(self, results=None, error=None):
        self.calls: list[tuple[str, re.Pattern]] = []
        self._results, self._error = list(results or []), error

    def __call__(self, sql, allowed):
        self.calls.append((sql, allowed))
        if self._error:
            raise self._error
        return self._results.pop(0) if self._results else QueryResult(statement="x")


# ------------------------------------------------------------------ statements
def test_statements_match_their_own_patterns_even_with_hostile_text():
    sql = insert_sql(TABLE, rec())
    assert insert_pattern(TABLE).fullmatch(sql)
    assert select_pattern(TABLE).fullmatch(select_sql(TABLE, "stu-1", 10))
    assert create_pattern(TABLE).fullmatch(create_table_sql(TABLE))


def test_free_text_never_appears_raw_in_sql_and_round_trips_through_base64():
    sql = insert_sql(TABLE, rec())
    assert "DROP TABLE" not in sql and "OR '1'" not in sql
    quoted = re.findall(r"'([^']*)'", sql)  # id, user, timestamp, question_b64, answer_b64, model
    assert base64.b64decode(quoted[3]).decode() == HOSTILE
    assert base64.b64decode(quoted[4]).decode() == HOSTILE * 3


@pytest.mark.parametrize(
    "bad_user",
    ["x' OR '1'='1", "x'; DROP TABLE t; --", "a b", "", "u" * 65, "a\nb", "a\\b", "a;b", 'a"b', "über"],
)
def test_user_id_injection_attempts_are_rejected(bad_user):
    with pytest.raises(HistoryError):
        select_sql(TABLE, bad_user, 5)
    with pytest.raises(HistoryError):
        insert_sql(TABLE, rec(user_id=bad_user))


@pytest.mark.parametrize("bad_table", ["t; DROP TABLE x", "a b", "a.b'", "", "1abc", "a..b", "a.b-c", "t) VALUES (1) --"])
def test_table_name_injection_attempts_are_rejected(bad_table):
    with pytest.raises(HistoryError):
        validate_table(bad_table)
    with pytest.raises(HistoryError):
        HistoryStore(bad_table)


@pytest.mark.parametrize(
    "field, value",
    [
        ("evaluation_id", "short"), ("evaluation_id", "0123456789abcde'"), ("created_at", "2026-10-27"), ("created_at", "x'--"),
        ("model", "m'; DROP"), ("model", ""), ("overall_score", 10.5), ("overall_score", -1.0), ("overall_score", float("nan")),
        ("clarity_score", 11), ("depth_score", -1), ("language_score", True), ("clarity_score", 6.5),
    ],
)
def test_malformed_record_fields_are_rejected(field, value):
    with pytest.raises(HistoryError):
        insert_sql(TABLE, rec(**{field: value}))


def test_oversized_text_is_rejected():
    with pytest.raises(HistoryError):
        insert_sql(TABLE, rec(answer="x" * 13_000))


@pytest.mark.parametrize("limit", [0, -1, 101, True, "5; DROP TABLE t", 2.5])
def test_limit_must_be_a_small_integer(limit):
    with pytest.raises(HistoryError):
        select_sql(TABLE, "stu-1", limit)  # type: ignore[arg-type]


# --------------------------------------------- the JDBC-layer allowlist (stricter than a prefix)
def test_valid_statements_pass_the_jdbc_allowlist_only_with_their_pattern():
    sql = insert_sql(TABLE, rec())
    _validate_statement(sql, insert_pattern(TABLE))
    with pytest.raises(PermissionError):
        _validate_statement(sql)  # no pattern supplied: the old discovery-only rule still applies
    with pytest.raises(PermissionError):
        _validate_statement(sql, select_pattern(TABLE))  # wrong pattern


@pytest.mark.parametrize(
    "tamper",
    [
        lambda s: s + ", ('0123456789abcdef', 'x', '2026-10-27T09:30:00Z', 1.0, 1, 1, 1, '', '', 'm')",
        lambda s: s.replace("'stu-1'", "'stu-1' OR 1=1"),
        lambda s: s.replace("INSERT INTO", "INSERT OVERWRITE"),
    ],
)
def test_tampered_insert_is_refused(tamper):
    with pytest.raises(PermissionError):
        _validate_statement(tamper(insert_sql(TABLE, rec())), insert_pattern(TABLE))


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1; DROP TABLE t",  # passes the discovery PREFIX check today; the ';' rule now stops it
        "SHOW SCHEMA; INSERT INTO t VALUES (1)",
        "DROP TABLE t",
        "DELETE FROM t",
        "UPDATE t SET a = 1",
        "INSERT INTO other_table VALUES (1)",
    ],
)
def test_jdbc_layer_rejects_multi_statement_and_unlisted_sql(sql):
    with pytest.raises(PermissionError):
        zetaris_jdbc.execute_statement(sql, url="u", user="u", password="p", jar_path="j", driver_class="d", java_home="h")


def test_discovery_statements_are_unchanged():
    for sql in zetaris_jdbc.DISCOVERY_STATEMENTS.values():
        _validate_statement(sql)
        assert _redact(sql) == sql
    _validate_statement("SHOW LIGHTNING TABLES my_db")


def test_redact_hides_everything_after_the_statement_head():
    out = _redact(insert_sql(TABLE, rec()))
    assert "VALUES" not in out and "redacted" in out and len(out) < 100


# ------------------------------------------------------------------------ store
def test_save_creates_the_table_once_then_inserts():
    ex = FakeExecutor()
    store = HistoryStore(TABLE, ex)
    store.save(rec())
    store.save(rec(evaluation_id="fedcba9876543210"))
    kinds = [c[0].split(" ", 1)[0] for c in ex.calls]
    assert kinds == ["CREATE", "INSERT", "INSERT"]
    assert all(pattern.fullmatch(sql) for sql, pattern in ex.calls)


def test_failed_table_setup_means_nothing_is_inserted_and_setup_is_retried():
    ex = FakeExecutor(results=[QueryResult(statement="x", error="boom")])
    store = HistoryStore(TABLE, ex)
    with pytest.raises(HistoryError):
        store.save(rec())
    assert [c[0].split(" ", 1)[0] for c in ex.calls] == ["CREATE"]
    store.save(rec())  # next attempt retries the setup and then writes
    assert [c[0].split(" ", 1)[0] for c in ex.calls] == ["CREATE", "CREATE", "INSERT"]


def test_invalid_record_never_reaches_the_executor():
    ex = FakeExecutor()
    with pytest.raises(HistoryError):
        HistoryStore(TABLE, ex).save(rec(user_id="x' OR '1'='1"))
    assert ex.calls == []


@pytest.mark.parametrize("failure", [FakeExecutor(error=RuntimeError("jvm down")), FakeExecutor(error=PermissionError("nope")), FakeExecutor(results=[QueryResult(statement="s", error="driver says no")] * 2)])
def test_connection_or_query_failure_becomes_a_clean_history_error(failure):
    with pytest.raises(HistoryError) as exc:
        HistoryStore(TABLE, failure).save(rec())
    assert "driver says no" not in str(exc.value) and "jvm down" not in str(exc.value)


def _row(eid, user, ts, overall, c, d, l, question):
    return [eid, user, ts, overall, c, d, l, base64.b64encode(question.encode()).decode()]


def test_list_returns_decoded_rows_for_the_requested_user_only():
    rows = [
        _row("aaaaaaaaaaaaaaaa", "stu-1", "2026-10-02T00:00:00Z", 7.0, 8, 6, 7, "Q2?"),
        _row("bbbbbbbbbbbbbbbb", "stu-2", "2026-10-02T00:00:00Z", 9.0, 9, 9, 9, "someone else's"),  # must be dropped
        _row("cccccccccccccccc", "stu-1", "2026-10-01T00:00:00Z", 5.0, 5, 5, 5, "Q1?"),
    ]
    ex = FakeExecutor(results=[QueryResult(statement="s", rows=rows)])
    got = HistoryStore(TABLE, ex).list_for_user("stu-1", 10)
    assert [e.question for e in got] == ["Q2?", "Q1?"] and all(e.user_id == "stu-1" for e in got)
    assert "WHERE user_id = 'stu-1'" in ex.calls[0][0]


def test_malformed_rows_are_skipped_not_fatal():
    rows = [["x"], _row("aaaaaaaaaaaaaaaa", "stu-1", "t", "nan?", 1, 1, 1, "Q"), ["a", "stu-1", "t", 1.0, 1, 1, 1, "!!not-base64!!"],
            _row("cccccccccccccccc", "stu-1", "2026-10-01T00:00:00Z", 5.0, 5, 5, 5, "ok")]
    got = HistoryStore(TABLE, FakeExecutor(results=[QueryResult(statement="s", rows=rows)])).list_for_user("stu-1")
    assert [e.evaluation_id for e in got] == ["cccccccccccccccc"]


def test_different_users_get_different_statements():
    ex = FakeExecutor(results=[QueryResult(statement="s"), QueryResult(statement="s")])
    store = HistoryStore(TABLE, ex)
    store.list_for_user("alice")
    store.list_for_user("bob")
    assert "'alice'" in ex.calls[0][0] and "'bob'" not in ex.calls[0][0] and "'bob'" in ex.calls[1][0]


# ------------------------------------------------------------------ log hygiene
@pytest.mark.parametrize("failure", [RuntimeError("driver echoed the statement"), None])
def test_logs_never_contain_student_text(caplog, failure):
    secret_answer = "MY-PRIVATE-ANSWER-TEXT"
    r = rec(question="MY-PRIVATE-QUESTION", answer=secret_answer)
    ex = FakeExecutor(error=failure) if failure else FakeExecutor(results=[QueryResult(statement="s", error="e")])
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(HistoryError):
            HistoryStore(TABLE, ex).save(r)
    logged = caplog.text
    assert secret_answer not in logged and "MY-PRIVATE-QUESTION" not in logged
    assert base64.b64encode(secret_answer.encode()).decode() not in logged


def test_jdbc_layer_error_results_and_logs_are_redacted(caplog, monkeypatch):
    """execute_statement itself: a failing INSERT must not echo the statement in logs or in QueryResult."""
    sql = insert_sql(TABLE, rec(answer="MY-PRIVATE-ANSWER-TEXT"))

    def boom(*a, **k):
        raise RuntimeError("connect failed")

    monkeypatch.setattr(zetaris_jdbc, "_jdbc_connection", boom)
    with caplog.at_level(logging.DEBUG):
        qr = zetaris_jdbc.execute_statement(sql, url="u", user="u", password="p", jar_path="j", driver_class="d", java_home="h", allowed=insert_pattern(TABLE))
    assert not qr.ok and "VALUES" not in qr.statement and "redacted" in qr.statement
    assert base64.b64encode(b"MY-PRIVATE-ANSWER-TEXT").decode() not in caplog.text
