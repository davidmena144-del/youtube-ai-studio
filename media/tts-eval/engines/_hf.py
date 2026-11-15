"""Minimal pinned HuggingFace download (public, non-gated models only: no account, no token)."""
from __future__ import annotations

import os
import urllib.request
from pathlib import Path

CACHE = Path(os.environ.get("TTS_CACHE", Path.home() / ".cache" / "tts-eval"))


def fetch(repo: str, revision: str, filename: str) -> Path:
    dest = CACHE / repo.replace("/", "__") / revision / filename
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"
        tmp = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest
