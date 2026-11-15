"""Vercel（Python Functions）用のエントリーポイント。

常駐ワーカーの代わりに、Web側がジョブ登録時に POST /api/process を呼び出す。
呼ばれるたびにキューを処理して終了する（Vercel Hobby の最大実行時間は300秒）。

ローカル確認: flask --app app run -p 8001
"""
from __future__ import annotations

import hmac
import logging
import os
import sys

# Vercel ではプロジェクトのルートが作業ディレクトリになるが、念のため自分の場所を import パスに入れる
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request  # noqa: E402

from config import load_config  # noqa: E402
from transcribers import Transcriber, create_transcriber  # noqa: E402
from worker import drain_queue  # noqa: E402

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(message)s")
log = logging.getLogger("app")

app = Flask(__name__)

_cfg = load_config()
_transcriber: "Transcriber | None" = None


def _get_transcriber() -> Transcriber:
    # コールドスタート時に1回だけ作る（同じインスタンスが再利用される間は使い回す）
    global _transcriber
    if _transcriber is None:
        _transcriber = create_transcriber(_cfg)
    return _transcriber


def _authorized() -> bool:
    if not _cfg.worker_secret:
        return False
    given = request.headers.get("Authorization", "")
    return hmac.compare_digest(given.encode(), f"Bearer {_cfg.worker_secret}".encode())


@app.post("/api/process")
def process():
    if not _cfg.worker_secret:
        log.error("WORKER_SECRET is not set")
        return jsonify(error="server_misconfigured"), 500
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    result = drain_queue(_cfg, _get_transcriber(), _cfg.drain_time_budget_sec)
    log.info("drain result: %s", result)
    return jsonify(result)


@app.get("/api/health")
def health():
    return jsonify(ok=True)
