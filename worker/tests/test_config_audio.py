from pathlib import Path

import pytest

import config as config_mod
from audio import prepare_audio
from errors import FetchError

_real_load_dotenv = config_mod.load_dotenv  # fixture で差し替える前の関数

ENV_KEYS = ["TRANSCRIBER", "GROQ_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "TRANSCRIBE_MODEL",
            "TRANSCRIBE_PRICE_PER_MINUTE_USD", "AUDIO_EXTRACT"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    # worker/.env を読まないようにする
    monkeypatch.setattr(config_mod, "load_dotenv", lambda path: None)


def test_groq_defaults(monkeypatch):
    monkeypatch.setenv("TRANSCRIBER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-be-used")
    cfg = config_mod.load_config()
    assert cfg.api_key == "gsk_test"
    assert cfg.api_base_url == "https://api.groq.com/openai/v1"
    assert cfg.transcribe_model == "whisper-large-v3-turbo"
    assert cfg.price_per_minute_usd == 0.0


def test_empty_values_fall_back_to_defaults(monkeypatch):
    # .env の `TRANSCRIBE_MODEL=` のような空欄で既定値が消えないこと
    monkeypatch.setenv("TRANSCRIBER", "openai")
    monkeypatch.setenv("TRANSCRIBE_MODEL", "")
    monkeypatch.setenv("TRANSCRIBE_PRICE_PER_MINUTE_USD", "")
    cfg = config_mod.load_config()
    assert cfg.transcribe_model == "whisper-1"
    assert cfg.price_per_minute_usd == 0.006
    assert cfg.audio_extract == "auto"


def test_dotenv_skips_empty_values(tmp_path, monkeypatch):
    monkeypatch.delenv("FOO_TEST_KEY", raising=False)
    monkeypatch.delenv("BAR_TEST_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("FOO_TEST_KEY=\nBAR_TEST_KEY='bar'\n# comment\n", encoding="utf-8")
    import os

    _real_load_dotenv(str(env))
    assert "FOO_TEST_KEY" not in os.environ
    assert os.environ["BAR_TEST_KEY"] == "bar"
    monkeypatch.delenv("BAR_TEST_KEY")


def test_prepare_audio_none_returns_media(tmp_path: Path):
    media = tmp_path / "source.mp4"
    media.write_bytes(b"x" * 100)
    assert prepare_audio(media, tmp_path, "none", 1000) == media


def test_prepare_audio_rejects_too_large(tmp_path: Path):
    media = tmp_path / "source.mp4"
    media.write_bytes(b"x" * 2000)
    with pytest.raises(FetchError, match="大きすぎ"):
        prepare_audio(media, tmp_path, "none", 1000)


def test_prepare_audio_unknown_mode(tmp_path: Path):
    with pytest.raises(ValueError):
        prepare_audio(tmp_path / "x", tmp_path, "bogus", 1000)
