from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Protocol


@dataclass
class Segment:
    start: float
    end: float
    text: str
    no_speech_prob: Optional[float] = None
    avg_logprob: Optional[float] = None


@dataclass
class TranscriptResult:
    segments: List[Segment]
    language: Optional[str]
    cost_usd: float
    engine: str
    extra: dict = field(default_factory=dict)


class Transcriber(Protocol):
    name: str

    def transcribe(self, audio_path: Path, duration_sec: float) -> TranscriptResult:
        ...


_LEADING_DASH = re.compile(r"^(?:[-－–—]\s*)+")


def clean_segments(segments: Iterable[Segment], duration_sec: Optional[float] = None) -> List[Segment]:
    """空文字と無音区間の幻聴（Whisperが無音部分で定型文を出す現象）を除き、時刻を整える。

    判定は Whisper 本家の無音判定（no_speech_prob > 0.6 かつ avg_logprob < -1.0）に合わせている。
    """
    out: List[Segment] = []
    for s in segments:
        # Whisper（特に Groq の large-v3-turbo）が会話文の記号として行頭に付ける "- " を除く
        text = _LEADING_DASH.sub("", (s.text or "").strip()).strip()
        if not text:
            continue
        if (
            s.no_speech_prob is not None
            and s.avg_logprob is not None
            and s.no_speech_prob > 0.6
            and s.avg_logprob < -1.0
        ):
            continue
        start = max(0.0, float(s.start))
        end = max(start, float(s.end))
        if duration_sec:
            start = min(start, duration_sec)
            end = min(end, duration_sec)
        out.append(Segment(start=round(start, 2), end=round(end, 2), text=text))
    return out
