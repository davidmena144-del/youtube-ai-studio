"""Score every engine's output and build the blind listening set + summary.

    python media/tts-eval/score.py --in out --report report [--asr large-v3-turbo] [--threads 2]

Objective metrics (no human needed):
  * intelligibility: Whisper ASR transcribes each sample; CER against the script (normalised Arabic).
    Reported separately for text-only passages, because spoken numbers/Latin words legitimately
    differ from their written digits/letters.
  * audio QA (ffmpeg): integrated loudness (LUFS), true peak, clipped-sample ratio, long pauses.
  * speed: RTF and the projected time to narrate 8 minutes on this runner.
Subjective: a blind set (engines renamed A, B, C…, loudness-matched to -16 LUFS) for the owner.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_passages, normalize_for_cer  # noqa: E402

BLIND_SAMPLES = ["p02_numbers", "p08_prosody", "p11_short_script", "p13_egyptian", "p14_emotion_excited"]
TEXT_ONLY_TAGS = {"numbers", "latin-script", "loanwords", "dialect"}  # excluded from the headline CER
GATE_RTF = 1.5
GATE_CER = 0.15  # informational: owner's listening score is the real quality gate


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(ref: str, hyp: str) -> float:
    r, h = normalize_for_cer(ref).replace(" ", ""), normalize_for_cer(hyp).replace(" ", "")
    return round(levenshtein(r, h) / max(1, len(r)), 3)


def ffmpeg_qa(wav: Path) -> dict:
    log = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
         "ebur128=peak=true,silencedetect=noise=-45dB:d=1.2,astats=metadata=0", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
    peak = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", log)
    return {
        "lufs": float(lufs[-1]) if lufs else None,
        "true_peak_dbfs": float(peak[-1]) if peak else None,
        "long_pauses": len(re.findall(r"silence_end", log)),
    }


def clipped_ratio(wav: Path) -> float:
    import numpy as np
    import soundfile as sf

    x, _ = sf.read(wav, dtype="float32")
    return round(float(np.mean(np.abs(x) >= 0.999)), 5) if len(x) else 0.0


def to_mp3(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1", "-b:a", "96k", str(dst)],
        check=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--asr", default="large-v3-turbo")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--seed", type=int, default=0, help="blind-label shuffle seed (0 = random)")
    args = ap.parse_args()

    passages = {p["id"]: p for p in load_passages()}
    report = Path(args.report)
    report.mkdir(parents=True, exist_ok=True)
    results = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(Path(args.inp).glob("*/result.json"))]
    if not results:
        print("no engine results found", file=sys.stderr)
        return 1

    asr = None
    if args.asr != "none":  # "none": skip ASR (local smoke test of the rest of the scorer)
        from faster_whisper import WhisperModel

        asr = WhisperModel(args.asr, device="cpu", compute_type="int8", cpu_threads=args.threads)

    for r in results:
        engine_dir = Path(args.inp) / r["engine"]
        install = engine_dir / "install_s.txt"
        r["install_s"] = float(install.read_text()) if install.exists() else None
        for s in r["samples"]:
            if not s["ok"]:
                continue
            wav = engine_dir / s["file"]
            if asr is not None:
                segs, _ = asr.transcribe(str(wav), language="ar", beam_size=5, vad_filter=False)
                s["asr_text"] = " ".join(seg.text.strip() for seg in segs)
                s["cer"] = cer(passages[s["sample_id"]]["text"], s["asr_text"])
            s.update(ffmpeg_qa(wav))
            s["clipped_ratio"] = clipped_ratio(wav)
            print(f"[score] {r['engine']} {s['sample_id']}: cer={s.get('cer')} lufs={s['lufs']} pauses={s['long_pauses']}", flush=True)

        ok = [s for s in r["samples"] if s["ok"]]
        text_only = [s.get("cer") for s in ok if not (set(passages[s["sample_id"]]["tags"]) & TEXT_ONLY_TAGS)]
        text_only = [c for c in text_only if c is not None]
        allc = [s["cer"] for s in ok if s.get("cer") is not None]
        r["cer_text_only"] = round(sum(text_only) / len(text_only), 3) if text_only else None
        r["cer_all"] = round(sum(allc) / len(allc), 3) if allc else None
        r["projected_8min_narration_min"] = round(r["rtf"] * 8, 1) if r.get("rtf") else None
        r["gate"] = {
            "licence_ok": r["commercial_ok"] is True,
            "rtf_ok": bool(r.get("rtf") is not None and r["rtf"] <= GATE_RTF),
            "cer_ok": bool(r["cer_text_only"] is not None and r["cer_text_only"] <= GATE_CER),
            "no_failures": r["failures"] == 0,
        }

    # Blind set: same letter for an engine across its samples, so the owner can rate per engine.
    rng = random.Random(args.seed or None)
    letters = [chr(ord("A") + i) for i in range(len(results))]
    rng.shuffle(letters)
    key = {}
    for letter, r in zip(letters, results):
        key[letter] = r["engine"]
        for s in r["samples"]:
            if s["ok"] and s["sample_id"] in BLIND_SAMPLES:
                to_mp3(Path(args.inp) / r["engine"] / s["file"], report / "blind" / f"{s['sample_id']}__{letter}.mp3")
    (report / "blind_key.json").write_text(json.dumps(key, indent=2), encoding="utf-8")
    (report / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (report / "summary.md").write_text(summary_md(results), encoding="utf-8")
    print(summary_md(results))
    return 0


def summary_md(results: list[dict]) -> str:
    rows = [
        "| engine | licence ok | install s | load s | RTF (2 vCPU) | 8-min narration | peak RAM MB | failures | CER text-only | CER all | gate |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in sorted(results, key=lambda r: (r.get("rtf") or 1e9)):
        g = r["gate"]
        rows.append(
            f"| {r['engine']} | {'yes' if g['licence_ok'] else 'NO/unclear'} | {r.get('install_s')} | {r['load_s']} | {r['rtf']} | "
            f"{r['projected_8min_narration_min']} min | {r['peak_ram_mb']} | {r['failures']} | {r['cer_text_only']} | {r['cer_all']} | "
            f"{'PASS' if all(g.values()) else 'fail: ' + ','.join(k for k, v in g.items() if not v)} |"
        )
    detail = ["", "| engine | sample | ok | RTF | audio s | CER | LUFS | true peak | pauses>1.2s | clipped | error |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        for s in r["samples"]:
            detail.append(
                f"| {r['engine']} | {s['sample_id']} | {s['ok']} | {s['rtf']} | {s['duration_s']} | {s.get('cer')} | {s.get('lufs')} | "
                f"{s.get('true_peak_dbfs')} | {s.get('long_pauses')} | {s.get('clipped_ratio')} | {(s.get('error') or '')[:80]} |"
            )
    return "\n".join(["## Arabic TTS benchmark", "", *rows, *detail, ""])


if __name__ == "__main__":
    raise SystemExit(main())
