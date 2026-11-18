"""Put the current hook overlay (hook.inject.html) into a hand-written page.
    python3 hook_apply.py <page.html> '<HOOK json>'      (re-running replaces the old hook block)
Also adds the /*@SFX@*/ placeholder so build.mjs inlines the samples the hook plays."""
import json, re, sys, pathlib
here = pathlib.Path(__file__).resolve().parent
page = here / sys.argv[1]
cfg = json.loads(sys.argv[2])
s = page.read_text()
i = s.find("<script>window.HOOK")
if i >= 0:
    s = s[:i] + s[s.rindex("</body>"):]
if "/*@SFX@*/" not in s:
    s = s.replace("<script>", "<script>/*@SFX@*/</script>\n<script>", 1)
block = "<script>window.HOOK = " + json.dumps(cfg, ensure_ascii=False) + ";</script>\n" + (here / "hook.inject.html").read_text()
k = s.rindex("</body>")
page.write_text(s[:k] + block + s[k:])
print("hook ->", page.name)
