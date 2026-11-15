"""Narration: one WAV per script segment (exact timings drive captions and scene cuts)."""
from __future__ import annotations

import importlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # media/ → engines package
from engines.text import split_text  # noqa: E402

DEFAULT_ENGINE = os.environ.get("TTS_ENGINE", "silma")
GAP_S = 0.15  # pause between chunks inside a segment
SEGMENT_PAD_S = 0.35  # breathing room after each segment


@dataclass
class Narrated:
    path: Path
    sr: int
    segments: list[tuple[str, float, float]]  # (text, start, end) on the final timeline
    engine: str
    engine_license: str


def narrate(texts: list[str], out_dir: Path, engine_name: str = DEFAULT_ENGINE, threads: int = 2) -> Narrated:
    engine = importlib.import_module(f"engines.{engine_name}")
    if engine.COMMERCIAL_OK is not True:
        raise RuntimeError(f"TTS engine {engine_name} is not cleared for commercial use ({engine.LICENSE})")
    model = engine.load(threads=threads)
    pieces: list[np.ndarray] = []
    segments: list[tuple[str, float, float]] = []
    sr = None
    t = 0.0
    for text in texts:
        start = t
        for chunk in split_text(text, engine.MAX_CHARS):
            wav, sr = engine.synth(model, chunk)
            wav = np.asarray(wav, dtype=np.float32).reshape(-1)
            pieces += [wav, np.zeros(int(sr * GAP_S), dtype=np.float32)]
            t += len(wav) / sr + GAP_S
        segments.append((text, round(start, 3), round(t, 3)))
        pieces.append(np.zeros(int(sr * SEGMENT_PAD_S), dtype=np.float32))
        t += SEGMENT_PAD_S
    if sr is None:
        raise RuntimeError("nothing to narrate")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "narration.wav"
    sf.write(path, np.concatenate(pieces), sr)
    return Narrated(path, sr, segments, engine_name, engine.LICENSE)
