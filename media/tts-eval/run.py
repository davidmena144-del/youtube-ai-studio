"""Synthesise every benchmark passage with one engine and record speed/memory/failures.

    python media/tts-eval/run.py --engine silma --out out/silma [--threads 2] [--only p01_plain,p02_numbers]

Writes <out>/<sample_id>.wav and <out>/result.json. A failing passage is recorded, not fatal.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # media/: shared engines package
from common import EngineResult, SampleResult, Timer, host_info, load_passages, peak_rss_mb, split_text  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", type=int, default=int(os.environ.get("TTS_THREADS", "2")))
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    # Pin CPU threads before torch/onnxruntime are imported (fair comparison on a 2-vCPU runner).
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[var] = str(args.threads)

    import numpy as np
    import soundfile as sf

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    engine = importlib.import_module(f"engines.{args.engine}")
    res = EngineResult(
        engine=args.engine,
        model=engine.MODEL,
        version=engine.version(),
        license=engine.LICENSE,
        license_source=engine.LICENSE_SOURCE,
        commercial_ok=engine.COMMERCIAL_OK,
        threads=args.threads,
        notes=getattr(engine, "NOTES", ""),
        host=host_info(),
    )

    with Timer() as t:
        model = engine.load(threads=args.threads)
    res.load_s = round(t.s, 2)
    print(f"[{args.engine}] loaded in {res.load_s}s", flush=True)

    only = {s for s in args.only.split(",") if s}
    for p in load_passages():
        if only and p["id"] not in only:
            continue
        sr_ = SampleResult(sample_id=p["id"], ok=False)
        try:
            chunks = split_text(p["text"], engine.MAX_CHARS)
            sr_.chunks = len(chunks)
            pieces: list[np.ndarray] = []
            rate = None
            with Timer() as t:
                for c in chunks:
                    wav, rate = engine.synth(model, c)
                    pieces.append(np.asarray(wav, dtype=np.float32).reshape(-1))
                    pieces.append(np.zeros(int(rate * 0.15), dtype=np.float32))  # 150 ms between chunks
            audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
            sr_.synth_s = round(t.s, 2)
            sr_.duration_s = round(len(audio) / rate, 2) if rate else 0.0
            if sr_.duration_s < 0.3:
                raise RuntimeError("engine returned (almost) no audio")
            sr_.rtf = round(sr_.synth_s / sr_.duration_s, 3)
            path = out / f"{p['id']}.wav"
            sf.write(path, audio, rate)
            sr_.file = path.name
            sr_.ok = True
        except Exception as e:  # record and continue: failures are a measured outcome
            sr_.error = f"{type(e).__name__}: {e}"[:500]
            traceback.print_exc()
        res.samples.append(sr_)
        print(f"[{args.engine}] {p['id']}: ok={sr_.ok} synth={sr_.synth_s}s audio={sr_.duration_s}s rtf={sr_.rtf}", flush=True)

    ok = [s for s in res.samples if s.ok]
    res.failures = len(res.samples) - len(ok)
    res.total_audio_s = round(sum(s.duration_s for s in ok), 2)
    res.total_synth_s = round(sum(s.synth_s for s in ok), 2)
    res.rtf = round(res.total_synth_s / res.total_audio_s, 3) if res.total_audio_s else None
    res.peak_ram_mb = peak_rss_mb()
    (out / "result.json").write_text(res.to_json(), encoding="utf-8")
    print(f"[{args.engine}] RTF={res.rtf} peakRAM={res.peak_ram_mb}MB failures={res.failures}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
