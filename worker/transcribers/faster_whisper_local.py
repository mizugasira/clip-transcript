"""自前の faster-whisper での文字起こし（APIキー不要・従量課金なし）。

初回はモデルをダウンロードする。CPUでも動くが、small 以上はGPU推奨。
"""
from __future__ import annotations

import os
import sys
import sysconfig
from pathlib import Path

from config import Config

from .base import Segment, TranscriptResult


def _register_nvidia_dlls() -> None:
    """Windows: pip で入れた NVIDIA ライブラリ（nvidia-cublas-cu12 / nvidia-cudnn-cu12）を見つけられるようにする。

    CTranslate2 は GPU 実行時に cublas64_12.dll 等を読み込むが、site-packages/nvidia/*/bin は
    既定の検索パスに入っていないため、DLL検索パスと PATH の両方に追加する。
    """
    if sys.platform != "win32":
        return
    nvidia_root = Path(sysconfig.get_paths()["purelib"]) / "nvidia"
    if not nvidia_root.is_dir():
        return
    for bin_dir in nvidia_root.glob("*/bin"):
        os.add_dll_directory(str(bin_dir))
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"


class FasterWhisperTranscriber:
    def __init__(self, cfg: Config):
        _register_nvidia_dlls()
        from faster_whisper import WhisperModel

        self.cfg = cfg
        self.model = WhisperModel(cfg.transcribe_model, device=cfg.fw_device, compute_type=cfg.fw_compute_type)
        self.name = f"faster_whisper:{cfg.transcribe_model}"

    def _run(self, path: Path, language):
        return self.model.transcribe(
            str(path),
            language=language or None,
            vad_filter=True,
            beam_size=5,
            initial_prompt=self.cfg.transcribe_prompt or None,
        )

    def transcribe(self, audio_path: Path, duration_sec: float) -> TranscriptResult:
        segments_iter, info = self._run(audio_path, self.cfg.transcribe_language)
        # 日本語優先: 自動判定の確信度が低い場合は優先言語でやり直す（segments は遅延評価なので無駄は少ない）
        if (
            not self.cfg.transcribe_language
            and self.cfg.prefer_language
            and info.language != self.cfg.prefer_language
            and info.language_probability < 0.6
        ):
            segments_iter, info = self._run(audio_path, self.cfg.prefer_language)

        segments = [
            Segment(
                start=s.start,
                end=s.end,
                text=s.text,
                no_speech_prob=s.no_speech_prob,
                avg_logprob=s.avg_logprob,
            )
            for s in segments_iter
        ]
        return TranscriptResult(
            segments=segments,
            language=info.language,
            cost_usd=0.0,
            engine=self.name,
            extra={"language_probability": info.language_probability},
        )
