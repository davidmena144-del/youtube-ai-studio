"""Score every engine's output and build the blind listening set + summary.

    python media/tts-eval/score.py --in out --report report [--asr large-v3-turbo] [--threads 2]

Objective metrics (no human needed):
  * intelligibility: Whisper ASR transcribes each sample; CER against the script (normalised Arabic).
    Reported separately for text-only passages, because spoken numbers/Latin words legitimately
    differ from their written digits/letters.
  * audio QA (ffmpeg): integrated loudness (LUFS), true peak, clipped-sample ratio, long pauses.
  * speed: RTF and the projected time to narrate 8 minutes on this runner.
  * prosody (numpy): median pitch, pitch range (semitones, p10–p90) and speaking rate per sample, so
    emotion passages can be compared objectively (excited vs sad vs suspense) besides listening.
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

BLIND_SAMPLES = ["p02_numbers", "p08_prosody", "p11_short_script", "p13_egyptian", "p14_emotion_excited",
                 "p15_emotion_sad", "p17_egyptian_explainer", "p18_emotion_suspense"]
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


ARABIC_LETTER = re.compile(r"[\u0621-\u064A]")


def prosody(wav: Path, text: str) -> dict:
    """Pitch statistics with an FFT autocorrelation tracker (40 ms frames, 10 ms hop, 70–400 Hz)."""
    import numpy as np
    import soundfile as sf

    x, sr = sf.read(str(wav), dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    dur = len(x) / sr
    fl, hop = int(0.04 * sr), int(0.01 * sr)
    lo, hi = int(sr / 400), int(sr / 70)
    ref = float(np.sqrt(np.mean(x**2))) + 1e-9
    f0 = []
    for i in range(0, max(0, len(x) - fl), hop):
        fr = x[i : i + fl] - x[i : i + fl].mean()
        if float(np.sqrt(np.mean(fr**2))) < 0.3 * ref:
            continue
        spec = np.fft.rfft(fr, 2 * fl)
        ac = np.fft.irfft(np.abs(spec) ** 2)[:fl]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] > 0.45:
            f0.append(sr / lag)
    letters = len(ARABIC_LETTER.findall(text))
    out = {"letters_per_s": round(letters / dur, 2) if dur else None, "voiced_frames": len(f0)}
    if len(f0) >= 10:
        a = np.array(f0)
        p10, p50, p90 = np.percentile(a, [10, 50, 90])
        out.update({"f0_median_hz": round(float(p50), 1), "f0_range_st": round(float(12 * np.log2(p90 / p10)), 2)})
    return out


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
            s.update(prosody(wav, passages[s["sample_id"]]["text"]))
            print(f"[score] {r['engine']} {s['sample_id']}: cer={s.get('cer')} lufs={s['lufs']} pauses={s['long_pauses']} "
                  f"f0={s.get('f0_median_hz')} range={s.get('f0_range_st')} rate={s.get('letters_per_s')}", flush=True)

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
    detail = ["", "| engine | sample | ok | RTF | audio s | CER | LUFS | true peak | pauses>1.2s | clipped | F0 median Hz | F0 range st | letters/s | error |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in results:
        for s in r["samples"]:
            detail.append(
                f"| {r['engine']} | {s['sample_id']} | {s['ok']} | {s['rtf']} | {s['duration_s']} | {s.get('cer')} | {s.get('lufs')} | "
                f"{s.get('true_peak_dbfs')} | {s.get('long_pauses')} | {s.get('clipped_ratio')} | {s.get('f0_median_hz')} | "
                f"{s.get('f0_range_st')} | {s.get('letters_per_s')} | {(s.get('error') or '')[:80]} |"
            )
    return "\n".join(["## Arabic TTS benchmark", "", *rows, *detail, *expressiveness(results), ""])


def expressiveness(results: list[dict]) -> list[str]:
    """Dialect CER and emotion contrast: an expressive engine changes pitch/rate between moods."""
    def by_id(r):
        return {s["sample_id"]: s for s in r["samples"] if s["ok"]}

    out = ["", "### Dialect and emotion", "",
           "| engine | CER Egyptian (mean) | excited − sad: F0 (st) | excited − sad: rate | F0 range excited / sad / suspense (st) |",
           "|---|---|---|---|---|"]
    for r in results:
        m = by_id(r)
        eg = [m[k]["cer"] for k in ("p13_egyptian", "p17_egyptian_explainer") if k in m and m[k].get("cer") is not None]
        ex, sad, sus = m.get("p14_emotion_excited", {}), m.get("p15_emotion_sad", {}), m.get("p18_emotion_suspense", {})
        df0 = (round(12 * __import__("math").log2(ex["f0_median_hz"] / sad["f0_median_hz"]), 2)
               if ex.get("f0_median_hz") and sad.get("f0_median_hz") else None)
        drate = round(ex["letters_per_s"] - sad["letters_per_s"], 2) if ex.get("letters_per_s") and sad.get("letters_per_s") else None
        out.append(f"| {r['engine']} | {round(sum(eg) / len(eg), 3) if eg else None} | {df0} | {drate} | "
                   f"{ex.get('f0_range_st')} / {sad.get('f0_range_st')} / {sus.get('f0_range_st')} |")
    return out


if __name__ == "__main__":
    raise SystemExit(main())
