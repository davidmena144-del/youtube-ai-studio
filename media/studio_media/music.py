"""Original background music, synthesised here (numpy): no third-party rights, no Content ID risk.

A slow chord progression of soft detuned sine pads with gentle swells. Moods change the key,
tempo of chord changes and brightness.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
MOODS = {
    "calm": {"root": 57, "chord_s": 6.0, "bright": 0.25, "prog": [(0, 4, 7), (-3, 0, 4), (-7, -3, 0), (-5, -1, 2)]},
    "uplifting": {"root": 60, "chord_s": 4.0, "bright": 0.4, "prog": [(0, 4, 7), (7, 11, 14), (9, 12, 16), (5, 9, 12)]},
    "mysterious": {"root": 50, "chord_s": 7.0, "bright": 0.15, "prog": [(0, 3, 7), (-4, 0, 3), (1, 5, 8), (-2, 2, 5)]},
    "energetic": {"root": 62, "chord_s": 2.5, "bright": 0.5, "prog": [(0, 4, 7), (-3, 0, 4), (5, 9, 12), (7, 11, 14)]},
}


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def ambient(duration_s: float, mood: str = "calm", seed: int = 0) -> np.ndarray:
    cfg = MOODS.get(mood, MOODS["calm"])
    rng = np.random.default_rng(seed)
    n = int(duration_s * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float64)
    seg = int(cfg["chord_s"] * SR)
    fade = int(min(1.5, cfg["chord_s"] / 3) * SR)
    for i, start in enumerate(range(0, n, seg)):
        chord = cfg["prog"][i % len(cfg["prog"])]
        end = min(n, start + seg + fade)
        tt = t[start:end]
        env = np.ones(end - start)
        env[:fade] = np.linspace(0, 1, min(fade, end - start))
        env[-fade:] *= np.linspace(1, 0, min(fade, end - start))
        for semi in chord:
            f = _hz(cfg["root"] + semi)
            for det in (-0.12, 0.0, 0.12):  # chorus-like detune
                ph = rng.random() * 2 * np.pi
                out[start:end] += env * (np.sin(2 * np.pi * f * (1 + det / 100) * tt + ph) + cfg["bright"] * np.sin(4 * np.pi * f * tt + ph) / 2)
        bass = _hz(cfg["root"] + chord[0] - 12)
        out[start:end] += 0.8 * env * np.sin(2 * np.pi * bass * tt)
    swell = 0.75 + 0.25 * np.sin(2 * np.pi * t / 11.0)  # slow movement
    out *= swell
    k = 64  # gentle low-pass (moving average)
    out = np.convolve(out, np.ones(k) / k, mode="same")
    edge = min(n // 4, 2 * SR)
    out[:edge] *= np.linspace(0, 1, edge)
    out[-edge:] *= np.linspace(1, 0, edge)
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak * 0.5).astype(np.float32)


def write_music(path: Path, duration_s: float, mood: str = "calm", seed: int = 0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, ambient(duration_s, mood, seed), SR)
    return path
