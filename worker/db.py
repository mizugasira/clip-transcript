"""ジョブ表（jobs）をキューとして使うためのDB操作。"""
from __future__ import annotations

from typing import List, Optional, Tuple

import psycopg

from config import Config
from transcribers import Segment


def connect(cfg: Config) -> psycopg.Connection:
    if not cfg.database_url:
        raise ValueError("DATABASE_URL が設定されていません")
    kwargs = {}
    if cfg.database_sslmode:
        kwargs["sslmode"] = cfg.database_sslmode
    # prepare_threshold=None: Supabase の接続プーラー（トランザクションモード）でも動くよう、
    # サーバー側プリペアドステートメントを使わない
    return psycopg.connect(cfg.database_url, autocommit=True, prepare_threshold=None, **kwargs)


def claim_job(conn: psycopg.Connection) -> Optional[Tuple[int, str, float]]:
    """待機中のジョブを1件取り出して fetching にする。複数ワーカーでも SKIP LOCKED で重複しない。

    戻り値: (job_id, clip_id, clip_duration_sec)
    """
    row = conn.execute(
        """
        with next_job as (
          select id from jobs
          where status = 'queued'
          order by created_at, id
          for update skip locked
          limit 1
        )
        update jobs j
           set status = 'fetching', started_at = now(), updated_at = now()
          from next_job
         where j.id = next_job.id
        returning j.id, j.clip_id,
          (select duration_sec from clips c where c.id = j.clip_id)
        """
    ).fetchone()
    if not row:
        return None
    return int(row[0]), str(row[1]), float(row[2] or 0)


def set_status(conn: psycopg.Connection, job_id: int, status: str) -> None:
    conn.execute("update jobs set status = %s, updated_at = now() where id = %s", (status, job_id))


def save_result(
    conn: psycopg.Connection,
    job_id: int,
    clip_id: str,
    segments: List[Segment],
    language: Optional[str],
    audio_seconds: float,
    cost_usd: float,
    engine: str,
) -> None:
    with conn.transaction():
        conn.execute("delete from segments where clip_id = %s", (clip_id,))
        if segments:
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into segments (clip_id, idx, start_sec, end_sec, text) values (%s, %s, %s, %s, %s)",
                    [(clip_id, i, s.start, s.end, s.text) for i, s in enumerate(segments)],
                )
        conn.execute(
            "update clips set transcribed_at = now(), detected_language = %s where id = %s",
            (language, clip_id),
        )
        conn.execute(
            """update jobs set status = 'done', error = null, finished_at = now(), updated_at = now(),
                      audio_seconds = %s, cost_usd = %s, transcriber = %s
                where id = %s""",
            (audio_seconds, cost_usd, engine, job_id),
        )


def fail_job(conn: psycopg.Connection, job_id: int, message: str) -> None:
    conn.execute(
        "update jobs set status = 'failed', error = %s, finished_at = now(), updated_at = now() where id = %s",
        (message[:500], job_id),
    )


def fail_stale_jobs(conn: psycopg.Connection, minutes: float) -> int:
    """ワーカーの異常終了などで処理中のまま止まったジョブを失敗扱いにする（画面から再試行できる）。"""
    cur = conn.execute(
        """update jobs set status = 'failed', error = '処理がタイムアウトしました。再試行してください',
                  finished_at = now(), updated_at = now()
            where status in ('fetching', 'transcribing')
              and updated_at < now() - make_interval(secs => %s)""",
        (minutes * 60,),
    )
    return cur.rowcount or 0
