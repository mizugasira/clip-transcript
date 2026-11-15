"""文字起こしエンジンの差し替え口。"""
from __future__ import annotations

from config import Config

from .base import Segment, Transcriber, TranscriptResult, clean_segments

__all__ = ["Segment", "TranscriptResult", "Transcriber", "clean_segments", "create_transcriber"]


def create_transcriber(cfg: Config) -> Transcriber:
    # openai と groq はどちらも OpenAI 互換API（接続先とキーが違うだけ）
    if cfg.transcriber in ("openai", "groq"):
        from .openai_api import OpenAITranscriber

        return OpenAITranscriber(cfg)
    if cfg.transcriber == "faster_whisper":
        from .faster_whisper_local import FasterWhisperTranscriber

        return FasterWhisperTranscriber(cfg)
    raise ValueError(f"未知の TRANSCRIBER: {cfg.transcriber}（openai / groq / faster_whisper）")
