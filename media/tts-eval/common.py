"""Shared helpers for the Arabic TTS benchmark (Phase 2). Standard library + numpy/soundfile only."""
from __future__ import annotations

import json
import re
import resource
import time
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ----------------------------------------------------------------------------- text

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


_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_for_cer(text: str) -> str:
    """Spelling-insensitive Arabic normalisation for intelligibility scoring (CER)."""
    t = unicodedata.normalize("NFKC", text)
    t = _TASHKEEL.sub("", t)
    t = t.translate(_INDIC)
    t = re.sub("[أإآٱ]", "ا", t)
    t = t.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    t = t.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def load_passages() -> list[dict]:
    return json.loads((HERE / "passages.json").read_text(encoding="utf-8"))


# ----------------------------------------------------------------------------- measurement


def host_info() -> dict:
    import os
    import platform

    model = ""
    try:
        for line in open("/proc/cpuinfo", encoding="utf-8"):
            if line.startswith("model name"):
                model = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    mem_gb = None
    try:
        mem_gb = round(int(open("/proc/meminfo").readline().split()[1]) / 1024 / 1024, 1)
    except (OSError, ValueError, IndexError):
        pass
    return {"cpus": os.cpu_count(), "cpu_model": model, "mem_gb": mem_gb, "python": platform.python_version(),
            "runner": os.environ.get("RUNNER_NAME", "local")}


def peak_rss_mb() -> float:
    """Peak resident memory of this process and its finished children (Linux: KiB)."""
    me = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    kids = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return round(max(me, kids) / 1024, 1)


class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.s = time.perf_counter() - self.t0


@dataclass
class SampleResult:
    sample_id: str
    ok: bool
    chunks: int = 0
    synth_s: float = 0.0
    duration_s: float = 0.0
    rtf: float | None = None
    error: str | None = None
    file: str | None = None


@dataclass
class EngineResult:
    engine: str
    model: str
    version: str
    license: str
    license_source: str
    commercial_ok: bool | None
    threads: int
    load_s: float = 0.0
    peak_ram_mb: float = 0.0
    total_audio_s: float = 0.0
    total_synth_s: float = 0.0
    rtf: float | None = None
    failures: int = 0
    notes: str = ""
    host: dict = field(default_factory=dict)
    samples: list[SampleResult] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)
