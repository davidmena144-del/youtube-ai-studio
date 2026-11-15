"""Scene visuals and thumbnails (Pillow; Arabic shaped by libraqm).

Default visuals are generated procedurally (gradient + shapes + on-screen Arabic text), so they
carry no third-party rights at all. Optional photos come only from assets.py (Openverse, filtered
to licences that allow commercial use, with attribution recorded).
"""
from __future__ import annotations

import colorsys
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

FONT_DIRS = ["/usr/share/fonts/opentype/lemonada", "/usr/share/fonts/truetype/noto", "/usr/share/fonts/opentype/noto"]
CAPTION_FONTS_DIR = "/usr/share/fonts/truetype/noto"  # libass: Noto Sans Arabic (+ fontconfig fallback)
# Lemonada (OFL-1.1, apt fonts-lemonada): Arabic + Latin + punctuation in one face, because Pillow
# has no per-glyph fallback (Noto Kufi lacks "!" / Latin and rendered boxes in thumbnails).
FONT_BOLD = "Lemonada-Bold.otf"
FONT_KUFI = "Lemonada-Bold.otf"


def font_path(name: str) -> str:
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return str(p)
    raise FileNotFoundError(f"font {name} not found (apt-get install fonts-noto-core)")


_CMAPS: dict[str, set[int]] = {}


def missing_glyphs(text: str, name: str = FONT_BOLD) -> list[str]:
    """Characters the font cannot draw (they would render as boxes)."""
    if name not in _CMAPS:
        from fontTools.ttLib import TTFont

        _CMAPS[name] = set(TTFont(font_path(name)).getBestCmap())
    return sorted({c for c in text if not c.isspace() and ord(c) not in _CMAPS[name] and not 0x200B <= ord(c) <= 0x200F})


def _layout_kwargs() -> dict:
    if not features.check("raqm"):
        raise RuntimeError("Pillow without libraqm cannot shape Arabic correctly")
    return {"direction": "rtl", "language": "ar"}


def palette(seed: int) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    rnd = random.Random(seed)
    h = rnd.random()
    c1 = colorsys.hsv_to_rgb(h, 0.65, 0.35)
    c2 = colorsys.hsv_to_rgb((h + 0.12) % 1, 0.75, 0.18)
    accent = colorsys.hsv_to_rgb((h + 0.5) % 1, 0.85, 1.0)
    return tuple(tuple(int(v * 255) for v in c) for c in (c1, c2, accent))  # type: ignore[return-value]


def gradient(w: int, h: int, top, bottom) -> Image.Image:
    base = Image.new("RGB", (w, h), top)
    mask = Image.linear_gradient("L").resize((w, h))
    return Image.composite(Image.new("RGB", (w, h), bottom), base, mask)


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    kw = _layout_kwargs()
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if cur and draw.textlength(trial, font=font, **kw) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def draw_centered_text(img: Image.Image, text: str, size: int, box: tuple[int, int, int, int], fill, stroke=(0, 0, 0), font_name=FONT_BOLD) -> None:
    missing = missing_glyphs(text, font_name)
    if missing:
        raise ValueError(f"font {font_name} cannot draw {missing!r} in {text!r}")
    draw = ImageDraw.Draw(img)
    kw = _layout_kwargs()
    x0, y0, x1, y1 = box
    font = ImageFont.truetype(font_path(font_name), size)
    lines = wrap(draw, text, font, x1 - x0)
    while len(lines) > 4 and size > 24:  # shrink to fit
        size = int(size * 0.88)
        font = ImageFont.truetype(font_path(font_name), size)
        lines = wrap(draw, text, font, x1 - x0)
    line_h = int(size * 1.45)
    y = y0 + ((y1 - y0) - line_h * len(lines)) // 2
    for line in lines:
        tw = draw.textlength(line, font=font, **kw)
        draw.text((x0 + ((x1 - x0) - tw) / 2, y), line, font=font, fill=fill, stroke_width=max(2, size // 18), stroke_fill=stroke, **kw)
        y += line_h


def scene_card(text: str, w: int, h: int, seed: int, photo: Path | None = None) -> Image.Image:
    c1, c2, accent = palette(seed)
    img = gradient(w, h, c1, c2)
    if photo is not None:
        ph = Image.open(photo).convert("RGB")
        scale = max(w / ph.width, h / ph.height)
        ph = ph.resize((int(ph.width * scale) + 1, int(ph.height * scale) + 1))
        left, top = (ph.width - w) // 2, (ph.height - h) // 2
        ph = ph.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(1))
        img = Image.blend(ph, img, 0.45)
    draw = ImageDraw.Draw(img, "RGBA")
    rnd = random.Random(seed)
    for _ in range(7):  # soft decorative circles
        r = rnd.randint(min(w, h) // 10, min(w, h) // 3)
        cx, cy = rnd.randint(0, w), rnd.randint(0, h)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent + (rnd.randint(14, 34),))
    if text:
        vertical = h > w
        box = (int(w * 0.08), int(h * (0.18 if vertical else 0.2)), int(w * 0.92), int(h * (0.55 if vertical else 0.75)))
        draw_centered_text(img, text, int(min(w, h) * (0.085 if vertical else 0.075)), box, fill=(255, 255, 255))
    return img


def thumbnail(title: str, seed: int, out: Path, photo: Path | None = None, w: int = 1280, h: int = 720) -> Path:
    c1, c2, accent = palette(seed)
    img = scene_card("", w, h, seed, photo)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle((0, int(h * 0.62), w, h), fill=(0, 0, 0, 150))
    draw.rectangle((0, int(h * 0.62), w, int(h * 0.635)), fill=accent + (255,))
    draw_centered_text(img, title, int(h * 0.15), (int(w * 0.05), int(h * 0.05), int(w * 0.95), int(h * 0.62)), fill=(255, 255, 255), font_name=FONT_KUFI)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=88, optimize=True)  # YouTube limit: 2 MB
    return out
