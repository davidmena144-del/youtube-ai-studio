"""Build an explainer page: python3 make.py <name>  →  media/motion/<name>.html from explainer.template.html + explainers/<name>.js"""
import sys, pathlib
here = pathlib.Path(__file__).resolve().parent
name = sys.argv[1]
tpl = (here.parent / "explainer.template.html").read_text()
data = (here / f"{name}.js").read_text()
narr = here / f"{name}.narr.json"  # narration timing + voice (explainers/narr.py); the voice then sets the clock
if narr.exists():
    import base64, json
    n = json.loads(narr.read_text())
    n["audio"] = "data:audio/mpeg;base64," + base64.b64encode((here / f"{name}.voice.mp3").read_bytes()).decode()
    data = "window.NARR = " + json.dumps(n) + ";\n" + data
title = [l for l in data.splitlines() if l.startswith("// title:")][0].split(":", 1)[1].strip()
out = tpl.replace("/*@DATA@*/", data).replace("/*@TITLE@*/", title)
if "window.HOOK" in data:  # cold-open overlay (hook.inject.html), configured by the data file
    out = out.replace("</body>", (here.parent / "hook.inject.html").read_text() + "</body>")
(here.parent / f"{name}.html").write_text(out)
print("wrote", name + ".html")
