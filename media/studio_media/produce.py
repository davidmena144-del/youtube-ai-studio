"""Produce one upload-ready video from a spec written by the manager's specialists.

    python -m studio_media.produce --spec spec.json --out out_dir [--engine silma] [--photos]

spec.json:
{
  "format": "short" | "long",
  "title": "…", "thumbnail_text": "…", "music_mood": "calm|uplifting|mysterious|energetic",
  "segments": [{"text": "narration …", "on_screen": "short caption on the card", "photo_query": "optional english query"}]
}
Writes video.mp4, thumbnail.jpg, captions.srt, captions.ass, narration.wav and manifest.json
(timings, engine, licence ledger, QA). Exit code 0 only when QA passed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio_media import assets, captions, music, qa, render, tts, visuals  # noqa: E402


def produce(spec: dict, out: Path, engine: str, photos: bool, threads: int = 2) -> dict:
    t0 = time.time()
    fmt = spec["format"]
    w, h = render.FORMATS[fmt]
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(exist_ok=True)
    seed = int(hashlib.sha256(spec["title"].encode()).hexdigest()[:8], 16)
    segs = spec["segments"]
    if not segs:
        raise ValueError("spec has no segments")

    nar = tts.narrate([s["text"] for s in segs], work, engine, threads)
    t_tts = time.time()
    ledger: list[assets.Asset] = [assets.generated("narration", "work/narration.wav", f"TTS {nar.engine} ({nar.engine_license})")]

    clips = []
    for i, (seg, (_text, start, end)) in enumerate(zip(segs, nar.segments)):
        dur = end - start + tts.SEGMENT_PAD_S
        photo = None
        if photos and seg.get("photo_query"):
            a = assets.search_photo(seg["photo_query"], work, i)
            if a:
                ledger.append(a)
                photo = work / a.file
        card = work / f"card_{i:02d}.png"
        visuals.scene_card(seg.get("on_screen", ""), w, h, seed + i, photo).save(card)
        clips.append(render.scene_clip(card, dur, work / f"clip_{i:02d}.mp4", (w, h), i))
    total = sum(e - s + tts.SEGMENT_PAD_S for _, s, e in nar.segments)

    cues = captions.cues_for_segments(nar.segments, max_chars=30 if fmt == "short" else 42)
    srt, ass = out / "captions.srt", work / "captions.ass"
    srt.write_text(captions.to_srt(cues), encoding="utf-8")
    ass.write_text(captions.to_ass(cues, w, h, vertical=fmt == "short"), encoding="utf-8")

    bed = music.write_music(work / "music.wav", total + 1, spec.get("music_mood", "calm"), seed)
    ledger.append(assets.generated("music", "work/music.wav", f"procedural ambient ({spec.get('music_mood', 'calm')})"))
    video = render.compose(clips, nar.path, bed, ass, out / "video.mp4", visuals.CAPTION_FONTS_DIR, work)
    thumb = visuals.thumbnail(spec.get("thumbnail_text") or spec["title"], seed, out / "thumbnail.jpg")
    ledger.append(assets.generated("thumbnail", "thumbnail.jpg", "procedural"))
    t_render = time.time()

    ok, issues = assets.ledger_ok(ledger)
    report = qa.check(video, thumb, srt, fmt, total, ok, issues)
    attributions = [a.attribution or f"{a.title} — {a.creator} ({a.license})" for a in ledger if a.license == "by"]
    manifest = {
        "format": fmt, "title": spec["title"], "engine": nar.engine, "engine_license": nar.engine_license,
        "segments": [{"text": t, "start": s, "end": e} for t, s, e in nar.segments],
        "files": {"video": "video.mp4", "thumbnail": "thumbnail.jpg", "captions": "captions.srt"},
        "assets": assets.to_dicts(ledger), "attributions": attributions, "qa": report,
        "timing_s": {"tts": round(t_tts - t0, 1), "render": round(t_render - t_tts, 1), "total": round(time.time() - t0, 1)},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--engine", default=tts.DEFAULT_ENGINE)
    ap.add_argument("--photos", action="store_true")
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()
    m = produce(json.loads(Path(args.spec).read_text(encoding="utf-8")), Path(args.out), args.engine, args.photos, args.threads)
    print(json.dumps({"qa": m["qa"], "timing_s": m["timing_s"]}, ensure_ascii=False))
    return 0 if m["qa"]["passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
