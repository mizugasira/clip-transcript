"""文字起こしワーカー。

jobs 表をポーリングし、1件ずつ「音声取得 → 文字起こし → 保存」を行う。
音声・動画ファイルは一時ディレクトリに置き、処理後に必ず削除する（要件: データ保持）。

起動: python worker.py
"""
from __future__ import annotations

import logging
import os
import signal
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import psycopg

import db
from audio import prepare_audio
from config import Config, load_config
from errors import UserFacingError
from fetchers import get_fetcher
from transcribers import Transcriber, clean_segments, create_transcriber

log = logging.getLogger("worker")

_stop = threading.Event()


def _handle_signal(signum, _frame):
    log.info("signal %s received, stopping after current job", signum)
    _stop.set()


def process_job(
    conn: psycopg.Connection,
    cfg: Config,
    transcriber: Transcriber,
    job_id: int,
    clip_id: str,
    duration_sec: float,
) -> None:
    fetch = get_fetcher(cfg.fetcher)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="clip-") as tmp:
        workdir = Path(tmp)
        media = fetch(clip_id, workdir, cfg.max_clip_seconds)
        audio = prepare_audio(media, workdir, cfg.audio_extract, cfg.max_upload_bytes)
        if audio != media:
            media.unlink(missing_ok=True)  # 音声を抜き出したら動画はすぐ消す
        log.info("job %s: audio ready (%.1fs)", job_id, time.monotonic() - started)

        db.set_status(conn, job_id, "transcribing")
        result = transcriber.transcribe(audio, duration_sec)
    # ここで一時ディレクトリ（音声ファイル）は削除済み

    segments = clean_segments(result.segments, duration_sec or None)
    db.save_result(
        conn,
        job_id,
        clip_id,
        segments,
        result.language,
        audio_seconds=duration_sec,
        cost_usd=result.cost_usd,
        engine=result.engine,
    )
    log.info(
        "job %s: done clip=%s segments=%d lang=%s cost=$%.4f total=%.1fs",
        job_id, clip_id, len(segments), result.language, result.cost_usd, time.monotonic() - started,
    )


def run_once(conn: psycopg.Connection, cfg: Config, transcriber: Transcriber) -> bool:
    """ジョブを1件処理する。処理したら True。"""
    claimed = db.claim_job(conn)
    if not claimed:
        return False
    job_id, clip_id, duration_sec = claimed
    log.info("job %s: start clip=%s duration=%.1fs", job_id, clip_id, duration_sec)
    try:
        process_job(conn, cfg, transcriber, job_id, clip_id, duration_sec)
    except UserFacingError as e:
        log.warning("job %s: failed: %s", job_id, e.message)
        db.fail_job(conn, job_id, e.message)
    except psycopg.OperationalError:
        raise  # DB接続断は上位で再接続（ジョブは stale 判定で失敗扱いになる）
    except Exception:
        log.exception("job %s: unexpected error", job_id)
        db.fail_job(conn, job_id, "内部エラーが発生しました。時間をおいて再試行してください")
    return True


def drain_queue(cfg: Config, transcriber: Transcriber, time_budget_sec: float) -> dict:
    """サーバーレス用: キューが空になるか持ち時間を使い切るまでジョブを処理する。

    1件の処理（60秒クリップ）は通常数十秒以内のため、持ち時間を過ぎたら次のジョブは取らない。
    取り残したジョブは Web 側が次のポーリング時に再度呼び出す。
    """
    started = time.monotonic()
    processed = 0
    conn = db.connect(cfg)
    try:
        stale = db.fail_stale_jobs(conn, cfg.stale_job_minutes)
        while time.monotonic() - started < time_budget_sec:
            if not run_once(conn, cfg, transcriber):
                break
            processed += 1
    finally:
        conn.close()
    return {"processed": processed, "stale_failed": stale, "elapsed_sec": round(time.monotonic() - started, 1)}


def _start_health_server(port: int) -> None:
    """Cloud Run 等、HTTPポートの待ち受けが必要な実行環境向けの簡易ヘルスチェック。"""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *_args):
            pass

    server = HTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("health server listening on :%d", port)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config()
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    if os.environ.get("PORT"):
        _start_health_server(int(os.environ["PORT"]))

    get_fetcher(cfg.fetcher)  # 設定ミスは起動時に気づけるようにする
    transcriber = create_transcriber(cfg)
    log.info("worker started: fetcher=%s transcriber=%s", cfg.fetcher, transcriber.name)

    conn = None
    last_stale_check = 0.0
    while not _stop.is_set():
        try:
            if conn is None or conn.closed:
                conn = db.connect(cfg)
            if time.monotonic() - last_stale_check > 60:
                n = db.fail_stale_jobs(conn, cfg.stale_job_minutes)
                if n:
                    log.warning("marked %d stale job(s) as failed", n)
                last_stale_check = time.monotonic()
            if not run_once(conn, cfg, transcriber):
                _stop.wait(cfg.poll_interval_sec)
        except psycopg.OperationalError as e:
            log.error("database error: %s (reconnecting in 5s)", e)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            _stop.wait(5)
    if conn is not None:
        conn.close()
    log.info("worker stopped")


if __name__ == "__main__":
    main()
