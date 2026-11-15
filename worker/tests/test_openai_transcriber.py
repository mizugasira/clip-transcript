"""OpenAITranscriber のレスポンス変換（実APIは呼ばない）。"""
from dataclasses import replace
from types import SimpleNamespace

import pytest

from config import load_config
from errors import TranscribeError
from transcribers.openai_api import OpenAITranscriber


def make(tmp_path, response, **cfg_overrides):
    cfg = replace(load_config(), transcriber="openai", api_key="sk-test", transcribe_model="whisper-1",
                  price_per_minute_usd=0.006, **cfg_overrides)
    t = OpenAITranscriber(cfg)
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return response

    t.client = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create)))
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"fake")
    return t, audio, calls


def test_parses_segments_and_cost(tmp_path):
    res = SimpleNamespace(
        language="japanese",
        duration=30.0,
        text="こんにちは 今日は",
        segments=[
            SimpleNamespace(start=0.0, end=1.2, text=" こんにちは", no_speech_prob=0.01, avg_logprob=-0.2),
            SimpleNamespace(start=1.2, end=3.4, text=" 今日は", no_speech_prob=0.02, avg_logprob=-0.3),
        ],
    )
    t, audio, calls = make(tmp_path, res, transcribe_language="ja")
    out = t.transcribe(audio, 30.0)
    assert [s.text for s in out.segments] == [" こんにちは", " 今日は"]
    assert out.language == "japanese"
    assert out.cost_usd == pytest.approx(0.003)
    assert calls[0]["response_format"] == "verbose_json"
    assert calls[0]["timestamp_granularities"] == ["segment"]
    assert calls[0]["language"] == "ja"


def test_model_without_segments_is_reported(tmp_path):
    t, audio, _ = make(tmp_path, SimpleNamespace(text="全文だけ", segments=None))
    with pytest.raises(TranscribeError, match="セグメント"):
        t.transcribe(audio, 10.0)


def test_requires_api_key():
    with pytest.raises(ValueError):
        OpenAITranscriber(replace(load_config(), transcriber="openai", api_key=""))
