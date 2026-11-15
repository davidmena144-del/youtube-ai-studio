"""Chatterbox Multilingual V3 — 500M, MIT. Fallback candidate.
Caveats: the project is retired (no maintenance since Aug 2026); every output carries Resemble AI's
imperceptible Perth watermark (harmless for publishing, but noted)."""
from __future__ import annotations

import importlib.metadata

MODEL = "ResembleAI/chatterbox (t3_mtl23ls_v3 + s3gen), built-in default voice"
LICENSE = "MIT"
LICENSE_SOURCE = "https://huggingface.co/ResembleAI/chatterbox (license: mit)"
COMMERCIAL_OK = True
MAX_CHARS = 200
NOTES = "code pinned to github resemble-ai/chatterbox@ab55923c; retired project; Perth watermark on output"


def version() -> str:
    return importlib.metadata.version("chatterbox-tts") + "+git.ab55923c"


def load(threads: int):
    import torch

    torch.set_num_threads(threads)
    torch.manual_seed(1234)
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    return ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model="v3")


def synth(model, text: str):
    wav = model.generate(text, language_id="ar")
    return wav.squeeze(0).cpu().numpy(), model.sr
