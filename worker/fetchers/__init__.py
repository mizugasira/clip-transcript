"""音声取得方式（要件定義 6章）の差し替え口。

fetch(clip_id, workdir, max_seconds) -> Path（動画または音声ファイル）を実装したものを登録する。
  - "ytdlp": 方式B（Twitch内部API経由。yt-dlp を利用）
方式A（公式 Get Clips Download / OAuth 必須）や方式C（外部API）を足す場合はここに登録する。
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict

from . import ytdlp

Fetcher = Callable[[str, Path, float], Path]

FETCHERS: Dict[str, Fetcher] = {
    "ytdlp": ytdlp.fetch,
}


def get_fetcher(name: str) -> Fetcher:
    try:
        return FETCHERS[name]
    except KeyError:
        raise ValueError(f"未知の AUDIO_FETCHER: {name}（選択肢: {', '.join(FETCHERS)}）")
