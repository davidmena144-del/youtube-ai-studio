"""Lay a narration under an explainer and let it set the clock.

Usage: python3 narr.py <name> <dir with hook.wav and either take.wav (all lines in one take) or l0.wav, l1.wav, ...>

Reads explainers/<name>.say.json: {"voice": ..., "hook": "spoken hook", "lines": [[first caption time, "spoken text"], ...]}.
Each line covers the captions from its time up to the next line's time. The clips (one per line, made with the
chosen TTS voice) are trimmed, joined with short gaps into explainers/<name>.voice.mp3, and the caption times are
moved onto the voice: a line's captions share its clip in proportion to their length. Writes explainers/<name>.narr.json
({anchors: [[old time, new time], ...]}), which make.py inlines as window.NARR.
"""
import json, pathlib, re, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
name, clips = sys.argv[1], pathlib.Path(sys.argv[2])
say = json.loads((here / f"{name}.say.json").read_text())
src = (here / f"{name}.js").read_text()
caps = [(float(t), x) for t, x in re.findall(r'\[(\d+(?:\.\d+)?), "((?:[^"\\\\]|\\\\.)*)"\]', src[src.index("caps: ["):src.index("shots: [")])]
D0 = float(re.search(r"duration: (\d+(?:\.\d+)?)", src).group(1))
HOOK, GAP, TAIL = 2.0, 0.14, 1.3  # the hook overlay owns the first 2 s


def trim(i, wav):
    out = clips / f"t{i}.wav"
    f = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af", f, "-ar", "24000", "-ac", "1", str(out)], check=True)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)]))
    return out, d


def weight(text):  # digits are spoken as whole words
    t = re.sub(r"[\[\]]", "", text)
    return max(1, len(re.sub(r"\d", "", t)) + 5 * len(re.findall(r"\d+", t)))


def split_take(wav, n):
    """One continuous take of all the lines: cut it at the n-1 longest pauses (each line ends a sentence)."""
    log = subprocess.run(["ffmpeg", "-v", "info", "-i", str(wav), "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"], capture_output=True, text=True).stderr
    sil = sorted(zip(map(float, re.findall(r"silence_start: ([\d.]+)", log)), map(float, re.findall(r"silence_end: ([\d.]+)", log))))
    total = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)]))
    inner = [x for x in sil if x[0] > 0.3 and x[1] < total - 0.3]
    if len(inner) < n - 1:
        sys.exit(f"only {len(inner)} pauses for {n} lines")
    cuts = sorted(sorted(inner, key=lambda x: x[0] - x[1])[: n - 1])
    edges = [0.0] + [(a + b) / 2 for a, b in cuts] + [total]
    for i in range(n):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{edges[i]:.3f}", "-to", f"{edges[i + 1]:.3f}", "-i", str(wav), str(clips / f"l{i}.wav")], check=True)


if (clips / "take.wav").exists():
    split_take(clips / "take.wav", len(say["lines"]))
parts, anchors, t = [], [[0, 0]], 0.0
if say.get("hook"):
    f, d = trim("h", clips / "hook.wav")
    parts.append((0.0, f))
    t = d + GAP
anchors.append([HOOK - 0.01, HOOK - 0.01])
t = max(t, HOOK)
lines, rate = say["lines"], []
for i, (t0, _text) in enumerate(lines):
    t1 = lines[i + 1][0] if i + 1 < len(lines) else D0
    mine = [c for c in caps if t0 <= c[0] < t1]
    f, d = trim(i, clips / f"l{i}.wav")
    parts.append((t, f))
    rate.append(round(d / weight(_text), 3))
    w, acc = [weight(c[1]) for c in mine], 0
    for c, wi in zip(mine, w):
        anchors.append([c[0], round(t + d * acc / sum(w), 3)])
        acc += wi
    t += d + GAP
anchors.append([D0, round(t - GAP + TAIL, 3)])
args, flt = [], []
for i, (at, f) in enumerate(parts):
    args += ["-i", str(f)]
    flt.append(f"[{i}:a]adelay={int(at * 1000)}:all=1[a{i}]")
flt.append("".join(f"[a{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0[o]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-filter_complex", ";".join(flt), "-map", "[o]", "-ac", "1", "-b:a", "64k", str(here / f"{name}.voice.mp3")], check=True)
(here / f"{name}.narr.json").write_text(json.dumps({"voice": say.get("voice"), "anchors": anchors}, ensure_ascii=False) + "\n")
# a wrong cut shows as a line whose length is far from what its text predicts
print("seconds per character, per line:", rate)
if max(rate) > 2.2 * min(rate):
    sys.exit("line lengths do not match their text: check the cuts")
print(name, "duration", anchors[-1][1], "lines", len(lines))
