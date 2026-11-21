"""Build a 3D story page: python3 make3d.py <name>  ->  story3d/<name>.html
from story3d.template.html + stories/<name>.js, with three.js (vendor/three.min.js, MIT) inlined.
If stories/<name>.voice.mp3 (or .ogg/.wav) exists it is inlined as window.VOICE_URI (the narration), and
stories/<name>.timing.json as window.TIMING (start and end of every narration line, from voice.py)."""
import base64, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
name = sys.argv[1]
tpl = (here / "story3d.template.html").read_text()
data = (here / "stories" / f"{name}.js").read_text()
title = [l for l in data.splitlines() if l.startswith("// title:")][0].split(":", 1)[1].strip()
voice = ""
for ext, mime in (("mp3", "audio/mpeg"), ("ogg", "audio/ogg"), ("wav", "audio/wav")):
    p = here / "stories" / f"{name}.voice.{ext}"
    if p.exists():
        voice = f'window.VOICE_URI = "data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}";'
        break
timing = ""
tp = here / "stories" / f"{name}.timing.json"
if tp.exists():
    timing = "window.TIMING = " + tp.read_text().strip() + ";"
three = (here.parent / "vendor" / "three.min.js").read_text()
out = tpl.replace("/*@TITLE@*/", title).replace("/*@DATA@*/", data).replace("/*@VOICE@*/", voice).replace("/*@TIMING@*/", timing).replace("/*@THREE@*/", three)
(here / f"{name}.html").write_text(out)
print("wrote", name + ".html", "(with voice)" if voice else "(no voice)")
