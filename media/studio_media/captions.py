"""Arabic captions timed from the narration itself (no ASR needed).

Each script segment is synthesised separately, so its exact start/end is known. Inside a segment,
lines are split at word boundaries (≤ max_chars) and timed in proportion to their length.
Output: SRT (uploaded to YouTube as the caption track) and ASS (burned into the video by libass,
which shapes Arabic with HarfBuzz and orders it right-to-left with FriBiDi).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Cue:
    start: float
    end: float
    text: str


def split_words(text: str, max_chars: int) -> list[str]:
    lines, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def cues_for_segments(segments: list[tuple[str, float, float]], max_chars: int = 38) -> list[Cue]:
    """segments: (text, start_s, end_s) of each narrated segment."""
    cues: list[Cue] = []
    for text, start, end in segments:
        lines = split_words(text, max_chars)
        total = sum(len(l) for l in lines) or 1
        t = start
        for line in lines:
            d = (end - start) * len(line) / total
            cues.append(Cue(round(t, 3), round(t + d, 3), line))
            t += d
    return cues


def _ts(t: float, sep: str) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    if sep == ",":  # SRT
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"  # ASS


def to_srt(cues: list[Cue]) -> str:
    return "\n".join(f"{i}\n{_ts(c.start, ',')} --> {_ts(c.end, ',')}\n‫{c.text}‬\n" for i, c in enumerate(cues, 1))


def to_ass(cues: list[Cue], width: int, height: int, font: str = "Noto Sans Arabic", vertical: bool = False) -> str:
    size = int(height * (0.045 if vertical else 0.055))
    margin_v = int(height * (0.22 if vertical else 0.07))
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,{max(2, size // 12)},1,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body = "\n".join(f"Dialogue: 0,{_ts(c.start, '.')},{_ts(c.end, '.')},Default,,0,0,0,,{c.text}" for c in cues)
    return head + body + "\n"
