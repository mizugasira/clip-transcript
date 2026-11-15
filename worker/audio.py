"""文字起こしに渡す音声ファイルを用意する（ffmpeg で音声だけを抽出）。

ffmpeg が無い環境（Vercel 等）では、動画ファイルをそのまま渡す。
OpenAI / Groq の文字起こしAPIは mp4 を受け付け、faster-whisper も動画から音声を読める。
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from errors import FetchError


def find_ffmpeg() -> Optional[str]:
    explicit = os.environ.get("FFMPEG_PATH", "").strip()
    if explicit:
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # ffmpeg 同梱パッケージ（任意）

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ffmpeg_path() -> str:
    path = find_ffmpeg()
    if not path:
        raise RuntimeError("ffmpeg が見つかりません。FFMPEG_PATH を設定するか imageio-ffmpeg を入れてください")
    return path


def extract_audio(src: Path, dest_dir: Path, ffmpeg: Optional[str] = None) -> Path:
    """モノラル16kHzのFLACに変換する（音声認識に十分で、60秒で1〜2MB程度）。"""
    out = dest_dir / "audio.flac"
    cmd = [
        ffmpeg or ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", str(out),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=180)
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or b"").decode("utf-8", "replace")[-300:]
        raise FetchError(f"音声の抽出に失敗しました（{detail.strip() or 'ffmpeg error'}）") from e
    except subprocess.TimeoutExpired as e:
        raise FetchError("音声の抽出がタイムアウトしました") from e
    if not out.exists() or out.stat().st_size == 0:
        raise FetchError("クリップに音声が含まれていませんでした")
    return out


def prepare_audio(media: Path, dest_dir: Path, mode: str, max_upload_bytes: int) -> Path:
    """mode: auto / ffmpeg / none。返り値が media と同じなら抽出していない。"""
    if mode not in ("auto", "ffmpeg", "none"):
        raise ValueError(f"未知の AUDIO_EXTRACT: {mode}（auto / ffmpeg / none）")
    ffmpeg = find_ffmpeg() if mode != "none" else None
    if mode == "ffmpeg" and not ffmpeg:
        raise RuntimeError("AUDIO_EXTRACT=ffmpeg ですが ffmpeg が見つかりません")
    out = extract_audio(media, dest_dir, ffmpeg) if ffmpeg else media
    if out.stat().st_size > max_upload_bytes:
        raise FetchError(
            f"ファイルが大きすぎて文字起こしAPIに送れません（{out.stat().st_size // (1024 * 1024)}MB）"
        )
    return out
