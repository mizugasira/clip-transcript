"""環境変数からワーカー設定を読み込む。"""
from __future__ import annotations

import os
from dataclasses import dataclass

# 文字起こしエンジンごとの既定値: (モデル, 1分あたりの単価USD)
TRANSCRIBER_DEFAULTS = {
    "openai": ("whisper-1", 0.006),
    # Groq（OpenAI互換API）。無料枠の範囲なら課金なし
    "groq": ("whisper-large-v3-turbo", 0.0),
    "faster_whisper": ("small", 0.0),
}
GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _str(name: str, default: str = "") -> str:
    """空文字は未設定として扱う（.env の `KEY=` で既定値が消えないように）。"""
    v = os.environ.get(name, "").strip()
    return v if v else default


def _float(name: str, default: float) -> float:
    v = _str(name)
    try:
        return float(v) if v else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    database_url: str
    database_sslmode: str
    # 音声取得方式（6章）。現状は "ytdlp"（方式B）のみ実装。差し替え可能な作り
    fetcher: str
    # 音声抽出: auto（ffmpegがあれば抽出、無ければ動画のまま送る） / ffmpeg（必須） / none（抽出しない）
    audio_extract: str
    # 文字起こしエンジン: "openai" / "groq"（外部API） / "faster_whisper"（自前）
    transcriber: str
    # OpenAI互換APIのキーと接続先（openai / groq 共通）
    api_key: str
    api_base_url: str
    # モデル名は設定で切り替え可能にする（モデル廃止対策）
    transcribe_model: str
    # 空なら自動判定。"ja" 等を指定すると固定
    transcribe_language: str
    # 自動判定の確信度が低いときに使う言語（faster_whisper のみ有効）
    prefer_language: str
    transcribe_prompt: str
    price_per_minute_usd: float
    max_clip_seconds: float
    # 文字起こしAPIに送れるファイルの上限（Groq無料枠・OpenAIともに25MB）
    max_upload_bytes: int
    fw_device: str
    fw_compute_type: str
    poll_interval_sec: float
    stale_job_minutes: float
    # サーバーレス（Vercel）で1回の呼び出しに処理を続ける時間の目安
    drain_time_budget_sec: float
    # Webからの呼び出しを認証する共有シークレット（サーバーレス時）
    worker_secret: str


def load_dotenv(path: str) -> None:
    """KEY=VALUE 形式の .env を読み込む（既に設定済みの環境変数は上書きしない）。"""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if value:
                os.environ.setdefault(key, value)


def load_config() -> Config:
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    transcriber = _str("TRANSCRIBER", "openai")
    default_model, default_price = TRANSCRIBER_DEFAULTS.get(transcriber, ("", 0.0))
    if transcriber == "groq":
        api_key = _str("GROQ_API_KEY")
        base_url = _str("OPENAI_BASE_URL", GROQ_BASE_URL)
    else:
        api_key = _str("OPENAI_API_KEY")
        base_url = _str("OPENAI_BASE_URL")
    return Config(
        database_url=_str("DATABASE_URL"),
        database_sslmode=_str("DATABASE_SSLMODE"),
        fetcher=_str("AUDIO_FETCHER", "ytdlp"),
        audio_extract=_str("AUDIO_EXTRACT", "auto"),
        transcriber=transcriber,
        api_key=api_key,
        api_base_url=base_url,
        transcribe_model=_str("TRANSCRIBE_MODEL", default_model),
        transcribe_language=_str("TRANSCRIBE_LANGUAGE"),
        prefer_language=_str("PREFER_LANGUAGE", "ja"),
        transcribe_prompt=_str("TRANSCRIBE_PROMPT"),
        price_per_minute_usd=_float("TRANSCRIBE_PRICE_PER_MINUTE_USD", default_price),
        max_clip_seconds=_float("MAX_CLIP_SECONDS", 90),
        max_upload_bytes=int(_float("MAX_UPLOAD_MB", 25) * 1024 * 1024),
        fw_device=_str("FW_DEVICE", "auto"),
        fw_compute_type=_str("FW_COMPUTE_TYPE", "int8"),
        poll_interval_sec=_float("POLL_INTERVAL_SEC", 2),
        stale_job_minutes=_float("STALE_JOB_MINUTES", 15),
        drain_time_budget_sec=_float("DRAIN_TIME_BUDGET_SEC", 200),
        worker_secret=_str("WORKER_SECRET"),
    )
