"""Media QA for a rendered motion Short (no narration): writes manifest.json for the uploader.
    python3 qa.py <video.mp4> <out_dir> <title>
Checks: vertical 9:16 at 1080x1920 or larger, h264 + AAC, 15-60 s, integrated loudness -18..-13 LUFS, true peak <= -0.5 dBTP,
no black segment >= 1 s, no silence >= 2.5 s.
"""
import json, re, shutil, subprocess, sys
from pathlib import Path

video, out, title = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
out.mkdir(parents=True, exist_ok=True)
info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)], capture_output=True, text=True, check=True).stdout)
v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
dur = float(info["format"]["duration"])
log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vf", "blackdetect=d=1:pix_th=0.05", "-af", "ebur128=peak=true,silencedetect=n=-50dB:d=2.5", "-f", "null", "-"], capture_output=True, text=True).stderr
lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])
peak = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", log)[-1])
issues = []
if not v or not a: issues.append("missing video or audio stream")
else:
    if v["width"] < 1080 or v["width"] * 16 != v["height"] * 9: issues.append(f"resolution {v['width']}x{v['height']}")
    if v["codec_name"] != "h264" or a["codec_name"] != "aac": issues.append(f"codecs {v['codec_name']}/{a['codec_name']}")
if not 15 <= dur <= 60: issues.append(f"duration {dur:.1f}s outside 15-60s")
if not -18 <= lufs <= -13: issues.append(f"loudness {lufs} LUFS")
if peak > -0.5: issues.append(f"true peak {peak} dBTP")
if "black_start" in log: issues.append("black segment >= 1s")
if "silence_start" in log: issues.append("silence >= 2.5s")
shutil.copy(video, out / "video.mp4")
manifest = {"format": "short", "title": title, "engine": "motion (no narration)", "files": {"video": "video.mp4"}, "attributions": [],
            "qa": {"passed": not issues, "issues": issues, "duration_s": round(dur, 2), "lufs": lufs, "true_peak": peak, "size_bytes": int(info["format"]["size"])}}
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print("QA", json.dumps(manifest["qa"], ensure_ascii=False))
sys.exit(0 if not issues else 3)
