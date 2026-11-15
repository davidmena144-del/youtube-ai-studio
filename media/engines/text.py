"""Text chunking shared by the TTS benchmark and the production pipeline."""
from __future__ import annotations

import re

_SENT_END = re.compile(r"(?<=[\.\!\?؟!])\s+")
_CLAUSE = re.compile(r"(?<=[،,؛;])\s+")


def split_text(text: str, max_chars: int) -> list[str]:
    """Split into sentences, then clauses, so each chunk fits the engine's comfortable length."""
    out: list[str] = []
    for sent in _SENT_END.split(text.strip()):
        if len(sent) <= max_chars:
            out.append(sent)
            continue
        buf = ""
        for clause in _CLAUSE.split(sent):
            if buf and len(buf) + 1 + len(clause) > max_chars:
                out.append(buf)
                buf = clause
            else:
                buf = f"{buf} {clause}".strip()
        if buf:
            out.append(buf)
    return [c for c in out if c.strip()]
