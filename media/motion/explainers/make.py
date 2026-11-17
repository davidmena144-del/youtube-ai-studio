"""Build an explainer page: python3 make.py <name>  →  media/motion/<name>.html from explainer.template.html + explainers/<name>.js"""
import sys, pathlib
here = pathlib.Path(__file__).resolve().parent
name = sys.argv[1]
tpl = (here.parent / "explainer.template.html").read_text()
data = (here / f"{name}.js").read_text()
title = [l for l in data.splitlines() if l.startswith("// title:")][0].split(":", 1)[1].strip()
out = tpl.replace("/*@DATA@*/", data).replace("/*@TITLE@*/", title)
(here.parent / f"{name}.html").write_text(out)
print("wrote", name + ".html")
