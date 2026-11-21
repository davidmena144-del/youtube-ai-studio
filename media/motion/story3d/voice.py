"""Narrate a 3D story with the free SILMA voice (Apache-2.0 weights, runs on CPU).

    python voice.py <name> [--threads N]

Reads every `say: "..."` line of stories/<name>.js in order, synthesises each one, trims the silence
around it, joins them with a short pause and writes:
    stories/<name>.voice.mp3     the narration
    stories/<name>.timing.json   [[start, end], ...] of every line inside that file (seconds)
make3d.py inlines both, so the picture follows the real voice.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here.parent.parent))  # media/ (engines package)
from engines import silma  # noqa: E402

PAUSE = 0.30  # seconds between lines


def trim(wav: np.ndarray, sr: int, thresh: float = 0.012) -> np.ndarray:
    idx = np.where(np.abs(wav) > thresh)[0]
    if not len(idx):
        return wav
    a, b = max(0, idx[0] - int(0.03 * sr)), min(len(wav), idx[-1] + int(0.08 * sr))
    return wav[a:b]


def main() -> None:
    name = sys.argv[1]
    threads = int(sys.argv[sys.argv.index("--threads") + 1]) if "--threads" in sys.argv else 2
    src = (here / "stories" / f"{name}.js").read_text()
    lines = re.findall(r'say:\s*"([^"]+)"', src)
    if not lines:
        raise SystemExit("no say: lines found")
    model = silma.load(threads)
    parts, timing, t, sr = [], [], 0.0, 24000
    for i, text in enumerate(lines):
        wav, sr = silma.synth(model, text)
        wav = trim(np.asarray(wav, dtype=np.float32), sr)
        dur = len(wav) / sr
        timing.append([round(t, 3), round(t + dur, 3)])
        parts += [wav, np.zeros(int(PAUSE * sr), dtype=np.float32)]
        t += dur + PAUSE
        print(f"{i + 1}/{len(lines)} {dur:.2f}s", flush=True)
    full = np.concatenate(parts)
    full = full / max(1e-6, float(np.max(np.abs(full)))) * 0.92
    wav_path = here / "stories" / f"{name}.voice.wav"
    sf.write(wav_path, full, sr)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav_path), "-ac", "1", "-b:a", "96k", str(wav_path.with_suffix(".mp3"))], check=True)
    wav_path.unlink()
    (here / "stories" / f"{name}.timing.json").write_text(json.dumps(timing))
    print(f"voice: {len(lines)} lines, {t:.1f}s")


if __name__ == "__main__":
    main()
