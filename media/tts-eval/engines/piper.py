"""Piper (ONNX, very fast on CPU). BASELINE ONLY: the ar_JO voice's dataset licence is unclear
("License: See URL") and it was fine-tuned from the English lessac voice, so it is not shipped."""
from __future__ import annotations

import importlib.metadata

import numpy as np

from ._hf import fetch

REPO, REV = "rhasspy/piper-voices", "6b9cfaacb4"
VOICE = "ar/ar_JO/kareem/medium/ar_JO-kareem-medium"
MODEL = f"{REPO}@{REV}:{VOICE}"
LICENSE = "engine MIT (piper-tts); voice dataset licence unclear"
LICENSE_SOURCE = "https://huggingface.co/rhasspy/piper-voices/blob/main/ar/ar_JO/kareem/medium/MODEL_CARD"
COMMERCIAL_OK = None  # unknown → never used in production
MAX_CHARS = 400
NOTES = "built-in Arabic diacritizer (libtashkeel) enabled"


def version() -> str:
    return importlib.metadata.version("piper-tts")


def load(threads: int):
    from piper import PiperVoice

    onnx = fetch(REPO, REV, VOICE + ".onnx")
    fetch(REPO, REV, VOICE + ".onnx.json")
    voice = PiperVoice.load(str(onnx))
    voice.use_tashkeel = True
    return voice


def synth(voice, text: str):
    chunks = list(voice.synthesize(text))
    audio = np.concatenate([c.audio_float_array for c in chunks])
    return audio, chunks[0].sample_rate
