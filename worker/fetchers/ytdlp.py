"""方式B: yt-dlp でクリップ動画を取得する。

注意: Twitchの非公開の仕組みに依存するため、予告なく壊れる可能性がある（規約上もグレー）。
壊れた場合はまず `pip install -U yt-dlp` を試す。
"""
from __future__ import annotations

from pathlib import Path

from errors import FetchError

MAX_FILESIZE = 200 * 1024 * 1024


class _QuietLogger:
    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        pass

    def error(self, msg: str) -> None:
        pass


def fetch(clip_id: str, workdir: Path, max_seconds: float) -> Path:
    import yt_dlp

    url = f"https://clips.twitch.tv/{clip_id}"
    opts = {
        # 音声だけが目的なので一番小さい画質を選ぶ（Twitchクリップには音声のみのフォーマットが無い）
        "format": "worst[ext=mp4]/worst",
        "outtmpl": str(workdir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "socket_timeout": 30,
        "retries": 3,
        "max_filesize": MAX_FILESIZE,
        "cachedir": False,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise FetchError("クリップ情報を取得できませんでした")
            duration = info.get("duration")
            if duration and float(duration) > max_seconds:
                raise FetchError(f"{int(max_seconds)}秒を超える動画は処理しません")
            ydl.process_ie_result(info, download=True)
    except FetchError:
        raise
    except yt_dlp.utils.DownloadError as e:
        msg = str(e).replace("ERROR: ", "")[:300]
        raise FetchError(f"クリップ動画の取得に失敗しました（{msg}）") from e

    files = sorted(p for p in workdir.glob("source.*") if not p.name.endswith(".part"))
    if not files:
        raise FetchError("クリップ動画の取得に失敗しました（ファイルが見つかりません）")
    return files[0]
