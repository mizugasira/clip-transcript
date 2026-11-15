"""外部API（OpenAI 互換）での文字起こし。

セグメント単位の秒数（verbose_json + timestamp_granularities=segment）が必要。
OpenAI公式ドキュメント上、verbose_json に対応するのは whisper-1 のみ
（gpt-4o-transcribe / gpt-4o-mini-transcribe は json / text のみ）。
TRANSCRIBER=groq では Groq（https://api.groq.com/openai/v1）の Whisper large-v3 系を使う。
Groq も verbose_json + segment に対応している（公式ドキュメント記載）。
"""
from __future__ import annotations

from pathlib import Path

from config import Config
from errors import TranscribeError

from .base import Segment, TranscriptResult


def _get(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class OpenAITranscriber:
    def __init__(self, cfg: Config):
        if not cfg.api_key:
            key_name = "GROQ_API_KEY" if cfg.transcriber == "groq" else "OPENAI_API_KEY"
            raise ValueError(f"{key_name} が設定されていません")
        from openai import OpenAI

        self.cfg = cfg
        self.client = OpenAI(
            api_key=cfg.api_key,
            base_url=cfg.api_base_url or None,
            timeout=120,
            max_retries=2,
        )
        self.name = f"{cfg.transcriber}:{cfg.transcribe_model}"

    def transcribe(self, audio_path: Path, duration_sec: float) -> TranscriptResult:
        import openai

        kwargs = {
            "model": self.cfg.transcribe_model,
            "response_format": "verbose_json",
            "timestamp_granularities": ["segment"],
        }
        if self.cfg.transcribe_language:
            kwargs["language"] = self.cfg.transcribe_language
        if self.cfg.transcribe_prompt:
            kwargs["prompt"] = self.cfg.transcribe_prompt
        try:
            with open(audio_path, "rb") as f:
                res = self.client.audio.transcriptions.create(file=f, **kwargs)
        except openai.RateLimitError as e:
            raise TranscribeError("文字起こしAPIの利用上限に達しました。しばらく待って再試行してください") from e
        except openai.APIConnectionError as e:
            raise TranscribeError("文字起こしAPIに接続できませんでした") from e
        except openai.APIStatusError as e:
            raise TranscribeError(f"文字起こしAPIがエラーを返しました（HTTP {e.status_code}）") from e

        raw_segments = _get(res, "segments") or []
        if not raw_segments and _get(res, "text"):
            # セグメントを返さないモデルが設定されている
            raise TranscribeError(
                f"モデル {self.cfg.transcribe_model} は秒数（セグメント）を返しません。TRANSCRIBE_MODEL を whisper-1 等に変更してください"
            )
        segments = [
            Segment(
                start=float(_get(s, "start", 0.0)),
                end=float(_get(s, "end", 0.0)),
                text=str(_get(s, "text", "")),
                no_speech_prob=_get(s, "no_speech_prob"),
                avg_logprob=_get(s, "avg_logprob"),
            )
            for s in raw_segments
        ]
        billed_sec = float(_get(res, "duration", None) or duration_sec or 0)
        return TranscriptResult(
            segments=segments,
            language=_get(res, "language"),
            cost_usd=round(billed_sec / 60.0 * self.cfg.price_per_minute_usd, 6),
            engine=self.name,
        )
