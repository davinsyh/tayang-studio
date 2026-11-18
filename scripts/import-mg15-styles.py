"""Import eight published MG Styles 15 looks into the local Tayang library.

The visual definitions come from Opus Motion Library's MIT-licensed styles.json;
the original prompts, poster frames and demo films come from MG Styles 15 (MIT).
Both repositories are pinned to commits below so the import is repeatable.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests


OPUS_COMMIT = "8f1b78a25d0cf310c9bf904d434285046c4ed25a"
MG_COMMIT = "128c083bb0049e901a06af5d0cec3ad3291e8410"
OPUS_RAW = f"https://raw.githubusercontent.com/GovinduSasanka/opus-motion-library/{OPUS_COMMIT}"
MG_RAW = f"https://raw.githubusercontent.com/Vincentwei1021/mg-styles-15/{MG_COMMIT}"
MG_PAGE = f"https://github.com/Vincentwei1021/mg-styles-15/blob/{MG_COMMIT}"
PAIRS = {
    "flat-vector-pop": "01-flat-vector",
    "cel-boil": "05-cel-boil",
    "liquid-candy": "07-liquid",
    "shape-morph": "08-morph",
    "synthwave-vhs": "10-synthwave",
    "aurora-glass": "12-aurora-glass",
    "variety-hanazi": "18-hanazi",
    "sticker-explainer": "19-paperclip",
}
DATA = Path.home() / "AppData/Roaming/app.tayang.studio"
DB = DATA / "tayang.db"
MEDIA = DATA / "style-media"
BACKUPS = Path.home() / "AppData/Local/Tayang-Backups"


def get(url: str) -> bytes:
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    return response.content


def asset_url(path: Path) -> str:
    return "http://asset.localhost/" + quote(str(path.resolve()), safe="")


def section(body: str, title: str, next_title: str) -> str:
    return body.split(title, 1)[1].split(next_title, 1)[0].strip()


def main() -> None:
    with sqlite3.connect(DB) as db:
        existing = {row[0] for row in db.execute("SELECT id FROM styles WHERE id LIKE 'mg15-%'")}
    pending = {style_id: demo for style_id, demo in PAIRS.items() if f"mg15-{style_id}" not in existing}
    if not pending:
        print("All eight MG15 styles are already installed")
        subprocess.run([sys.executable, str(Path(__file__).with_name("install-mg15-starters.py"))], check=True)
        return

    catalog = json.loads(get(f"{OPUS_RAW}/styles.json"))
    definitions = {item["id"]: item for item in catalog}
    mg_license = get(f"{MG_RAW}/LICENSE")
    opus_license = get(f"{OPUS_RAW}/LICENSE")
    if not (mg_license.startswith(b"MIT License") and opus_license.startswith(b"MIT License")):
        raise RuntimeError("Expected MIT license text was not found")

    prepared = []
    for style_id, demo in pending.items():
        item = definitions[style_id]
        if "mg-styles-15" not in item["source"]:
            raise RuntimeError(f"Unexpected provenance for {style_id}")
        prompt_url = f"{MG_PAGE}/prompts/{demo}.md"
        prompt_source = get(f"{MG_RAW}/prompts/{demo}.md").decode("utf-8")
        prompt_body = prompt_source.split("```text", 1)[1].split("```", 1)[0]
        technique = section(prompt_body, "# Suggested technical route", "# Creative seed")
        signature = section(prompt_body, "# Signature features and key techniques (the result is judged against these)", "# How to work")
        poster = get(f"{MG_RAW}/videos/{demo}.jpg")
        film = get(f"{MG_RAW}/videos/{demo}.mp4")
        if not poster.startswith(b"\xff\xd8") or b"ftyp" not in film[:32]:
            raise RuntimeError(f"Unexpected media format for {demo}")

        local_id = f"mg15-{style_id}"
        folder = MEDIA / local_id
        folder.mkdir(parents=True, exist_ok=True)
        poster_path = folder / "poster.jpg"
        film_path = folder / "preview.mp4"
        poster_path.write_bytes(poster)
        film_path.write_bytes(film)
        small_path = folder / "preview-small.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(film_path),
            "-t", "6", "-vf", "scale=480:-2", "-an", "-c:v", "libx264",
            "-preset", "fast", "-crf", "30", "-movflags", "+faststart", str(small_path),
        ], check=True)
        os.replace(small_path, film_path)
        (folder / "LICENSE-MG15.txt").write_bytes(mg_license)
        (folder / "LICENSE-OPUS.txt").write_bytes(opus_license)

        source_record = {
            "source_prompt": prompt_url,
            "source_demo": f"{MG_PAGE}/demos/{demo}",
            "source_style_definition": f"https://github.com/GovinduSasanka/opus-motion-library/blob/{OPUS_COMMIT}/styles.json",
            "source_attribution": item["source"],
            "poster_sha256": hashlib.sha256(poster).hexdigest(),
            "source_video_sha256": hashlib.sha256(film).hexdigest(),
            "preview_sha256": hashlib.sha256(film_path.read_bytes()).hexdigest(),
        }
        (folder / "SOURCE.json").write_text(json.dumps(source_record, ensure_ascii=False, indent=2), encoding="utf-8")

        definition = {key: item[key] for key in ("description", "useFor", "palette", "fonts", "motionRules", "signature", "avoid", "source")}
        style_prompt = "\n".join([
            f"Imported style from MG Styles 15 by Vincentwei1021: {prompt_url}",
            f"Structured visual definition from Opus Motion Library by Govindu Sasanka: {source_record['source_style_definition']}",
            "Apply the published visual and motion rules below. The Tayang project brief controls the subject, duration, aspect ratio, language and voice; the source demo's 10-second script is only an example.",
            "\nOriginal style signature (from the published MG Styles 15 prompt):",
            signature,
            "\nPublished structured style definition (from Opus Motion Library):",
            json.dumps(definition, ensure_ascii=False, indent=2),
        ])
        notes = {
            "pacing": item.get("motionRules") or "",
            "type": "; ".join(f"{key}: {value}" for key, value in (item.get("fonts") or {}).items()),
            "color": "; ".join(f"{key}: {value}" for key, value in (item.get("palette") or {}).items() if key != "swatches"),
            "transitions": "; ".join(item.get("signature") or []),
        }
        notes = {key: value for key, value in notes.items() if value}
        build = "\n".join([
            f"Original demo code: {source_record['source_demo']}",
            "Published technical route:",
            technique,
            "Adapt the source's browser-based method to Tayang's HyperFrames project. Keep the project's required output path and render settings.",
        ])
        prepared.append((
            local_id, f"[MG15] {item['name']}", "mine", prompt_url,
            json.dumps(notes, ensure_ascii=False), style_prompt,
            datetime.now(timezone.utc).isoformat(), "hyperframes",
            asset_url(poster_path), asset_url(film_path), None, 1, None, build,
            json.dumps(item["palette"]["swatches"], ensure_ascii=False), "[]",
        ))

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup = BACKUPS / f"before-mg15-styles-{datetime.now():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(DB) as original, sqlite3.connect(backup) as copy:
        original.backup(copy)

    with sqlite3.connect(DB, timeout=30) as db:
        current = {row[0] for row in db.execute("SELECT id FROM styles")}
        for row in prepared:
            if row[0] in current:
                raise RuntimeError(f"Style already exists: {row[0]}")
        db.executemany(
            "INSERT INTO styles (id,name,source,source_url,notes,prompt,created_at,engine,preview_url,preview_video_url,template,version,based_on,build,palette,refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            prepared,
        )
        found = db.execute("SELECT count(*) FROM styles WHERE id LIKE 'mg15-%'").fetchone()[0]
        if found != len(existing) + len(prepared):
            raise RuntimeError(f"Expected {len(existing) + len(prepared)} imported styles, found {found}")

    print(f"Imported {len(prepared)} styles; database backup: {backup}")
    subprocess.run([sys.executable, str(Path(__file__).with_name("install-mg15-starters.py"))], check=True)


if __name__ == "__main__":
    main()
