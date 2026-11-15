"""SILMA TTS v1 — 150M, F5-TTS architecture pretrained FROM SCRATCH, weights Apache-2.0.
Primary candidate. Zero-shot: it speaks in the voice of a short reference clip."""
from __future__ import annotations

import importlib.metadata
from importlib.resources import files

MODEL = "silma-ai/silma-tts (model.pt, vocab.txt) + vocos-mel-24khz vocoder"
LICENSE = "weights Apache-2.0, code MIT"
LICENSE_SOURCE = "https://huggingface.co/silma-ai/silma-tts (card: 'pretrained from scratch', Apache-2.0)"
COMMERCIAL_OK = True
MAX_CHARS = 250
NOTES = (
    "reference voice = sample bundled in the Apache-2.0 package (speaker not identified); "
    "built-in number normalisation (NeMo) and automatic tashkeel (catt) enabled; nfe_step=16, seed=1234"
)

# Bundled reference clip and its transcription (from the SILMA model card).
REF_TEXT = "ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام."


def version() -> str:
    return importlib.metadata.version("silma-tts")


def _soundfile_load(path, *_args, **_kwargs):
    """torchaudio.load replacement: newer torchaudio routes through torchcodec, whose native
    library failed to load on the GitHub runner. SILMA only reads its reference clip with it."""
    import soundfile as sf
    import torch

    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return torch.from_numpy(data.T.copy()), sr


def load(threads: int):
    import torch
    import torchaudio

    torch.set_num_threads(threads)
    torchaudio.load = _soundfile_load
    from silma_tts.api import SilmaTTS

    return SilmaTTS(device="cpu")


def synth(model, text: str):
    ref = str(files("silma_tts").joinpath("infer/ref_audio_samples/ar.ref.24k.wav"))
    wav, sr, _spec = model.infer(ref_file=ref, ref_text=REF_TEXT, gen_text=text, seed=1234, show_info=lambda *a, **k: None)
    return wav, sr
