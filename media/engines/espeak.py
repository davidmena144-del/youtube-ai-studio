"""espeak-ng (formant synthesis). BASELINE ONLY: robotic, but fast, tiny and licence-clear
(engine GPL-3.0; generated audio is not covered by the GPL)."""
from __future__ import annotations

import io
import subprocess

import soundfile as sf

MODEL = "espeak-ng voice ar"
LICENSE = "GPL-3.0 (engine); output audio unrestricted"
LICENSE_SOURCE = "https://github.com/espeak-ng/espeak-ng/blob/master/COPYING"
COMMERCIAL_OK = True
MAX_CHARS = 600
NOTES = "formant synthesiser, no neural model"


def version() -> str:
    return subprocess.run(["espeak-ng", "--version"], capture_output=True, text=True).stdout.split()[3]


def load(threads: int):
    return None


def synth(_model, text: str):
    wav = subprocess.run(["espeak-ng", "-v", "ar", "-s", "150", "--stdout", text], capture_output=True, check=True).stdout
    audio, sr = sf.read(io.BytesIO(wav), dtype="float32")
    return audio, sr
