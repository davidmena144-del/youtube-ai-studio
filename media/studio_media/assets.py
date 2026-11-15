"""Optional stock photos from Openverse (anonymous API, no key, no account).

Only licences that allow commercial use WITHOUT share-alike are accepted: CC0, Public Domain Mark,
CC BY (attribution is recorded and goes into the video description). Every asset gets a ledger
entry; QA blocks a video whose ledger contains anything else.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

ALLOWED_LICENSES = {"cc0", "pdm", "by"}
API = "https://api.openverse.org/v1/images/"
UA = "youtube-ai-studio/1.0 (open-source channel tool)"


@dataclass
class Asset:
    kind: str
    source: str
    license: str
    license_url: str | None
    creator: str | None
    title: str | None
    landing_url: str | None
    attribution: str | None
    file: str


def generated(kind: str, file: str, note: str) -> Asset:
    return Asset(kind, "generated", "original", None, "youtube-ai-studio", note, None, None, file)


def search_photo(query: str, out_dir: Path, index: int, timeout: int = 20) -> Asset | None:
    """Best-effort: returns None on any failure (the scene falls back to a generated card)."""
    try:
        qs = urllib.parse.urlencode({"q": query, "license": ",".join(sorted(ALLOWED_LICENSES)), "page_size": 8, "mature": "false", "aspect_ratio": ""})
        req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            results = json.load(r).get("results", [])
        for item in results:
            lic = (item.get("license") or "").lower()
            if lic not in ALLOWED_LICENSES or not item.get("url"):
                continue
            dest = out_dir / f"photo_{index:02d}.jpg"
            dl = urllib.request.Request(item["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(dl, timeout=timeout) as r, open(dest, "wb") as f:
                f.write(r.read(15_000_000))
            return Asset("photo", "openverse", lic, item.get("license_url"), item.get("creator"), item.get("title"),
                         item.get("foreign_landing_url"), item.get("attribution"), dest.name)
    except Exception:
        return None
    return None


def ledger_ok(assets: list[Asset]) -> tuple[bool, list[str]]:
    bad = [f"{a.file}: licence {a.license}" for a in assets if a.license != "original" and a.license not in ALLOWED_LICENSES]
    missing = [f"{a.file}: missing attribution" for a in assets if a.license == "by" and not (a.attribution or a.creator)]
    return (not bad and not missing), bad + missing


def to_dicts(assets: list[Asset]) -> list[dict]:
    return [asdict(a) for a in assets]
