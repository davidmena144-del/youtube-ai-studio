"""FFmpeg rendering: animated scene cards + narration + ducked music + burned Arabic captions."""
from __future__ import annotations

import subprocess
from pathlib import Path

FPS = 30
FORMATS = {"short": (1080, 1920), "long": (1920, 1080)}


def run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({p.returncode}): {p.stderr[-1500:]}")


def scene_clip(image: Path, duration: float, out: Path, size: tuple[int, int], index: int) -> Path:
    """Slow Ken-Burns push-in (direction alternates per scene) from a still card."""
    w, h = size
    frames = max(1, round(duration * FPS))
    zoom = "min(zoom+0.0005,1.10)"
    x = "iw/2-(iw/zoom/2)" if index % 2 == 0 else "(iw-iw/zoom)*on/{}".format(frames)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(image),
        "-vf", f"scale={w * 2}:{h * 2},zoompan=z='{zoom}':x='{x}':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={FPS},format=yuv420p",
        "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out),
    ])
    return out


def compose(clips: list[Path], narration: Path, music: Path, ass: Path, out: Path, fonts_dir: str, work: Path) -> Path:
    listing = work / "clips.txt"
    listing.write_text("".join(f"file '{c.resolve()}'\n" for c in clips), encoding="utf-8")
    ass_arg = str(ass.resolve()).replace(":", r"\:")
    graph = (
        "[2:a]volume=0.22[m];"
        "[m][1:a]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];"
        "[1:a][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a];"
        # ass filter with COMPLEX shaping (HarfBuzz): the default rendered a box at lam-alef (لا).
        f"[0:v]ass=filename='{ass_arg}':fontsdir='{fonts_dir}':shaping=complex[v]"
    )
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(listing), "-i", str(narration), "-i", str(music),
        "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out),
    ])
    return out
