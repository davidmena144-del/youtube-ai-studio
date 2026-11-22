"""Speak one short Egyptian sample with a few VoiceTut-TTS built-in voices (CI only: needs the model download).

Usage: python voice_test.py <out_dir>   (speakers from $SPEAKERS, space separated; empty = all built-in voices)
"""
import os
import subprocess
import sys
import time

import torch
from voicetut_tts import VoiceTutTTS

TEXT = "خرطوم الفيل فيه حوالي أربعين ألف عضلة، وجسمك كله فيه ستمية بس! والفيل بياكل في اليوم مية وخمسين كيلو. تخيّل بقى!"

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
torch.set_num_threads(os.cpu_count() or 2)
tts = VoiceTutTTS.from_pretrained("mohammedaly22/VoiceTut-TTS")
names = os.environ.get("SPEAKERS", "").split()
if not names:
    found = None
    for attr in ("list_speakers", "speakers", "available_speakers"):
        v = getattr(tts, attr, None)
        if v is not None:
            found = v() if callable(v) else v
            break
    names = [s if isinstance(s, str) else (s.get("name") if isinstance(s, dict) else getattr(s, "name", str(s))) for s in (found or [])] or ["Mohamed", "Asmaa", "Sayed"]
log = []
for name in names:
    wav = os.path.join(out, f"{name}.wav")
    t0 = time.time()
    try:
        tts.synthesize(TEXT, speaker=name, output=wav)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-b:a", "128k", os.path.join(out, f"{name}.mp3")], check=True)
        os.remove(wav)
        log.append(f"{name}: ok in {time.time() - t0:.0f}s")
    except Exception as e:  # keep going: one bad voice should not hide the others
        log.append(f"{name}: FAILED {type(e).__name__}: {e}")
    print(log[-1], flush=True)
open(os.path.join(out, "report.txt"), "w", encoding="utf-8").write(TEXT + "\n" + "\n".join(log) + "\n")
if not any(": ok" in line for line in log):
    sys.exit(1)
