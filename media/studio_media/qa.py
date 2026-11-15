"""Automated media QA. A video is uploaded only if every check passes."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

LIMITS = {
    "short": {"min_s": 10, "max_s": 179, "w": 1080, "h": 1920},
    "long": {"min_s": 60, "max_s": 3 * 3600, "w": 1920, "h": 1080},
}
ARABIC = re.compile(r"[\u0600-\u06FF]")


def probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def measure(path: Path) -> dict:
    log = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-vf", "blackdetect=d=1.0:pix_th=0.05", "-af", "ebur128=peak=true,silencedetect=noise=-45dB:d=2.5", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
    peak = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", log)
    return {
        "lufs": float(lufs[-1]) if lufs else None,
        "true_peak": float(peak[-1]) if peak else None,
        "black_segments": len(re.findall(r"black_start", log)),
        "long_silences": len(re.findall(r"silence_end", log)),
    }


def check(video: Path, thumb: Path, srt: Path, fmt: str, narration_s: float, ledger_ok: bool, ledger_issues: list[str]) -> dict:
    lim = LIMITS[fmt]
    issues: list[str] = []
    info = probe(video)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    dur = float(info["format"]["duration"])
    if not v or not a:
        issues.append("missing video or audio stream")
    else:
        if (v["width"], v["height"]) != (lim["w"], lim["h"]):
            issues.append(f"resolution {v['width']}x{v['height']} != {lim['w']}x{lim['h']}")
        if v["codec_name"] != "h264" or a["codec_name"] != "aac":
            issues.append(f"codecs {v['codec_name']}/{a['codec_name']}")
    if not (lim["min_s"] <= dur <= lim["max_s"]):
        issues.append(f"duration {dur:.1f}s outside {lim['min_s']}-{lim['max_s']}s for {fmt}")
    if abs(dur - narration_s) > max(1.5, 0.03 * narration_s):
        issues.append(f"duration {dur:.1f}s does not match narration {narration_s:.1f}s")
    m = measure(video)
    if m["lufs"] is None or not (-17.5 <= m["lufs"] <= -11.5):
        issues.append(f"loudness {m['lufs']} LUFS outside -17.5..-11.5")
    if m["true_peak"] is not None and m["true_peak"] > -0.5:
        issues.append(f"true peak {m['true_peak']} dBFS > -0.5")
    if m["black_segments"]:
        issues.append(f"{m['black_segments']} black segment(s) ≥1s")
    if m["long_silences"]:
        issues.append(f"{m['long_silences']} silence(s) ≥2.5s")
    cues = srt.read_text(encoding="utf-8") if srt.exists() else ""
    if cues.count("-->") == 0 or not ARABIC.search(cues):
        issues.append("captions missing or not Arabic")
    if not thumb.exists() or thumb.stat().st_size > 2_000_000:
        issues.append("thumbnail missing or > 2 MB")
    if not ledger_ok:
        issues += [f"asset licence: {x}" for x in ledger_issues]
    return {"passed": not issues, "issues": issues, "duration_s": round(dur, 2), "size_bytes": int(info["format"]["size"]), **m}
