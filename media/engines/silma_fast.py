"""SILMA TTS v1 with 8 diffusion steps instead of 16: roughly half the compute, some quality cost.
Same model, licence and reference voice as engines.silma; measured separately in Phase 2."""
from __future__ import annotations

from . import silma as _silma

MODEL = _silma.MODEL + " (nfe_step=8)"
LICENSE = _silma.LICENSE
LICENSE_SOURCE = _silma.LICENSE_SOURCE
COMMERCIAL_OK = _silma.COMMERCIAL_OK
MAX_CHARS = _silma.MAX_CHARS
NOTES = _silma.NOTES.replace("nfe_step=16", "nfe_step=8")
version = _silma.version
load = _silma.load


def synth(model, text: str):
    return _silma.synth(model, text, nfe_step=8)
