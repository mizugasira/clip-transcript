"""実DBを使ったキュー処理の結合テスト（外部APIは使わず、取得・文字起こしをフェイクに差し替える）。

実行には空のテスト用DBが必要:  TEST_DATABASE_URL=postgresql://... pytest
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DB, reason="TEST_DATABASE_URL が未設定")

SCHEMA = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


@pytest.fixture()
def env():
    import psycopg

    import db
    import fetchers
    import worker
    from audio import ffmpeg_path
    from config import load_config
    from errors import FetchError
    from transcribers import Segment, TranscriptResult

    cfg = replace(load_config(), database_url=TEST_DB, fetcher="fake", audio_extract="auto",
                  worker_secret="test-secret")

    def fake_fetch(clip_id, workdir, max_seconds):
        if clip_id == "BrokenClip":
            raise FetchError("クリップ動画の取得に失敗しました（テスト）")
        out = workdir / "source.mp4"
        subprocess.run(
            [ffmpeg_path(), "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
             "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3", "-shortest", str(out)],
            check=True,
        )
        return out

    class FakeTranscriber:
        name = "fake"

        def transcribe(self, audio_path, duration_sec):
            assert audio_path.stat().st_size > 0
            seen["audio_path"] = audio_path
            return TranscriptResult(
                segments=[Segment(0.0, 1.5, " こんにちは "), Segment(1.5, 3.0, "テストです"), Segment(3, 3, " ")],
                language="japanese",
                cost_usd=0.0003,
                engine="fake",
            )

    seen = {}
    fetchers.FETCHERS["fake"] = fake_fetch
    conn = psycopg.connect(TEST_DB, autocommit=True)
    conn.execute("drop table if exists segments, jobs, clips cascade")
    conn.execute(SCHEMA.read_text(encoding="utf-8"))

    def add_clip(clip_id):
        conn.execute(
            """insert into clips (id, url, embed_url, title, broadcaster_id, broadcaster_name, duration_sec)
               values (%s, 'https://clips.twitch.tv/x', 'https://clips.twitch.tv/embed?clip=x', 't', '1', 'b', 3)""",
            (clip_id,),
        )
        conn.execute("insert into jobs (clip_id) values (%s)", (clip_id,))

    yield {"conn": conn, "cfg": cfg, "worker": worker, "db": db, "t": FakeTranscriber(), "add": add_clip, "seen": seen}
    fetchers.FETCHERS.pop("fake", None)
    conn.close()


def test_success_flow(env):
    conn, w = env["conn"], env["worker"]
    env["add"]("GoodClip")
    assert w.run_once(conn, env["cfg"], env["t"]) is True
    assert w.run_once(conn, env["cfg"], env["t"]) is False  # キューは空

    status, cost, engine = conn.execute("select status, cost_usd, transcriber from jobs").fetchone()
    assert (status, float(cost), engine) == ("done", 0.0003, "fake")
    rows = conn.execute("select idx, start_sec, end_sec, text from segments order by idx").fetchall()
    assert rows == [(0, 0.0, 1.5, "こんにちは"), (1, 1.5, 3.0, "テストです")]
    transcribed_at, lang = conn.execute("select transcribed_at, detected_language from clips").fetchone()
    assert transcribed_at is not None and lang == "japanese"
    # 音声ファイルは処理後に削除されている
    assert not env["seen"]["audio_path"].exists()


def test_failure_flow(env):
    conn, w = env["conn"], env["worker"]
    env["add"]("BrokenClip")
    w.run_once(conn, env["cfg"], env["t"])
    status, error = conn.execute("select status, error from jobs").fetchone()
    assert status == "failed" and "テスト" in error
    assert conn.execute("select transcribed_at from clips").fetchone()[0] is None
    # 失敗後は同じクリップに新しいジョブを登録できる（部分ユニークインデックス）
    conn.execute("insert into jobs (clip_id) values ('BrokenClip')")


def test_one_active_job_per_clip(env):
    import psycopg

    env["add"]("GoodClip")
    with pytest.raises(psycopg.errors.UniqueViolation):
        env["conn"].execute("insert into jobs (clip_id) values ('GoodClip')")


def test_stale_jobs_marked_failed(env):
    conn, db = env["conn"], env["db"]
    env["add"]("GoodClip")
    conn.execute("update jobs set status = 'transcribing', updated_at = now() - interval '1 hour'")
    assert db.fail_stale_jobs(conn, 15) == 1
    assert conn.execute("select status from jobs").fetchone()[0] == "failed"


def test_success_flow_extracts_flac(env):
    env["add"]("GoodClip")
    env["worker"].run_once(env["conn"], env["cfg"], env["t"])
    assert env["seen"]["audio_path"].suffix == ".flac"


def test_no_ffmpeg_sends_video_as_is(env):
    # Vercel 等 ffmpeg の無い環境: 動画ファイルのまま文字起こしに渡す
    cfg = replace(env["cfg"], audio_extract="none")
    env["add"]("GoodClip")
    env["worker"].run_once(env["conn"], cfg, env["t"])
    assert env["seen"]["audio_path"].suffix == ".mp4"
    assert env["conn"].execute("select status from jobs").fetchone()[0] == "done"
    assert not env["seen"]["audio_path"].exists()


def test_drain_queue_processes_all(env):
    for cid in ("ClipA1", "ClipB2", "BrokenClip"):
        env["add"](cid)
    result = env["worker"].drain_queue(env["cfg"], env["t"], time_budget_sec=60)
    assert result["processed"] == 3
    rows = dict(env["conn"].execute("select clip_id, status from jobs").fetchall())
    assert rows == {"ClipA1": "done", "ClipB2": "done", "BrokenClip": "failed"}


def test_drain_queue_respects_time_budget(env):
    env["add"]("ClipA1")
    result = env["worker"].drain_queue(env["cfg"], env["t"], time_budget_sec=0)
    assert result["processed"] == 0
    assert env["conn"].execute("select status from jobs").fetchone()[0] == "queued"


def test_http_endpoint_auth_and_process(env, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "_cfg", env["cfg"])
    monkeypatch.setattr(app_module, "_transcriber", env["t"])
    client = app_module.app.test_client()
    env["add"]("ClipA1")

    assert client.post("/api/process").status_code == 401
    assert client.post("/api/process", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/process").status_code == 405

    res = client.post("/api/process", headers={"Authorization": "Bearer test-secret"})
    assert res.status_code == 200 and res.get_json()["processed"] == 1
    assert env["conn"].execute("select status from jobs").fetchone()[0] == "done"


def test_http_endpoint_without_secret_is_disabled(env, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "_cfg", replace(env["cfg"], worker_secret=""))
    client = app_module.app.test_client()
    assert client.post("/api/process", headers={"Authorization": "Bearer "}).status_code == 500
