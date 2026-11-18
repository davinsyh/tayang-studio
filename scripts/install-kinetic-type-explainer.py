"""Install a sourced Kinetic Type starter and preview in the local Tayang library."""

from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests


COMMIT = "07258801b9e4ae80553816bb1606af7aa9a63dff"
BASE = "plugins/_official/video-templates/frame-kinetic-type"
RAW = f"https://raw.githubusercontent.com/nexu-io/open-design/{COMMIT}"
SOURCE_URL = f"https://github.com/nexu-io/open-design/tree/{COMMIT}/{BASE}"
TREE_URL = f"https://api.github.com/repos/nexu-io/open-design/git/trees/{COMMIT}?recursive=1"
STYLE_ID = "kinetic-type-explainer"
DATA = Path.home() / "AppData/Roaming/app.tayang.studio"
DB = DATA / "tayang.db"
TEMPLATES = DATA / "templates"
MEDIA = DATA / "style-media" / STYLE_ID
BACKUPS = Path.home() / "AppData/Local/Tayang-Backups"


def get(path: str) -> bytes:
    response = requests.get(f"{RAW}/{path}", timeout=60)
    response.raise_for_status()
    return response.content


def asset_url(path: Path) -> str:
    return "http://asset.localhost/" + quote(str(path.resolve()), safe="")


def main() -> None:
    with sqlite3.connect(DB) as db:
        existing = db.execute("SELECT template FROM styles WHERE id=?", (STYLE_ID,)).fetchone()
    if existing and existing[0]:
        meta = json.loads(existing[0])
        cached = TEMPLATES / f"{meta['sha256']}.zip"
        if meta.get("version", 0) >= 2 and cached.exists() and hashlib.sha256(cached.read_bytes()).hexdigest() == meta["sha256"]:
            print("Kinetic-Type Explainer already has a verified starter template")
            return

    response = requests.get(TREE_URL, timeout=30)
    response.raise_for_status()
    tree = response.json()["tree"]
    prefix = f"{BASE}/source/"
    paths = [item["path"] for item in tree if item["path"].startswith(prefix) and item["type"] == "blob"]
    paths += [f"{BASE}/{name}" for name in ("SKILL.md", "template.json", "preview.png", "preview.mp4")]
    paths += ["LICENSE"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        downloaded = dict(zip(paths, pool.map(get, paths)))
    if b"Apache License" not in downloaded["LICENSE"][:200]:
        raise RuntimeError("Expected Apache-2.0 license was not found")
    if b"ftyp" not in downloaded[f"{BASE}/preview.mp4"][:32]:
        raise RuntimeError("The published preview is not an MP4")

    guide = f"""# Kinetic-Type Explainer

This is an adaptation of the published **Kinetic Type** HyperFrames template from Open Design, pinned to commit {COMMIT}. The upstream title is Kinetic Type; "Explainer" describes the intended use in Tayang. The visual example, HTML/GSAP code, fonts and preview are sourced from {SOURCE_URL}. The project source is Apache-2.0; the bundled GSAP runtime states its own Standard License in index.html.

Start with index.html and compositions/main-graphics.html. Read SOURCE-SKILL.md and SOURCE.json. Replace the sample headline and statements with the user's verified explainer content, then adjust scene timing and aspect ratio for the requested video. Preserve the source's typography-led motion language; do not copy the sample subject into an unrelated video.

Run `npm install --ignore-scripts` and `npx hyperframes render --output renders/sample.mp4`. Tayang's tayang.json uses those commands. The source example is a 15-second 16:9 silent composition; create the narration through Tayang /voice and integrate it into the final project as directed by AGENTS.md.

HyperFrames 0.9.10 reports three transform-conflict lint findings in the upstream composition (CSS translateY and GSAP y on the same text lines). The published code still renders. Review those lines if you change their placement; do not use a strict lint gate without resolving the conflicts.
"""
    manifest = {
        "engine": "hyperframes",
        "install": ["npm", "install", "--ignore-scripts"],
        "render": ["npx", "hyperframes", "render", "--output", "{output}"],
        "readme": "STYLE.md",
    }
    package = {"private": True, "name": "tayang-kinetic-type-explainer", "version": "1.0.0", "dependencies": {"hyperframes": "0.9.10"}}
    source = {
        "repository": "https://github.com/nexu-io/open-design",
        "commit": COMMIT,
        "template": SOURCE_URL,
        "original": "https://github.com/heygen-com/hyperframes/tree/main/registry/examples/kinetic-type",
        "upstream_name": "Kinetic Type",
        "tayang_name": "Kinetic-Type Explainer",
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(paths):
            if path.startswith(prefix):
                archive.writestr(path.removeprefix(prefix), downloaded[path])
        archive.writestr("SOURCE-SKILL.md", downloaded[f"{BASE}/SKILL.md"])
        archive.writestr("SOURCE-TEMPLATE.json", downloaded[f"{BASE}/template.json"])
        archive.writestr("LICENSE", downloaded["LICENSE"])
        archive.writestr("STYLE.md", guide)
        archive.writestr("SOURCE.json", json.dumps(source, indent=2))
        archive.writestr("tayang.json", json.dumps(manifest, indent=2))
        archive.writestr("package.json", json.dumps(package, indent=2))
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    TEMPLATES.mkdir(parents=True, exist_ok=True)
    target = TEMPLATES / f"{digest}.zip"
    part = TEMPLATES / f"{digest}.part"
    part.write_bytes(data)
    os.replace(part, target)
    MEDIA.mkdir(parents=True, exist_ok=True)
    (MEDIA / "poster.png").write_bytes(downloaded[f"{BASE}/preview.png"])
    (MEDIA / "preview.mp4").write_bytes(downloaded[f"{BASE}/preview.mp4"])
    (MEDIA / "SOURCE.json").write_text(json.dumps(source, indent=2), encoding="utf-8")

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup = BACKUPS / f"before-kinetic-type-{datetime.now():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(DB) as original, sqlite3.connect(backup) as copy:
        original.backup(copy)
    meta = json.dumps({"sha256": digest, "size": len(data), "version": 2})
    note = json.dumps({"pacing": "Typography-led scenes and timed reveals", "type": "Inter and Playfair Display, as supplied by Open Design", "transitions": "Kinetic text, wipes and staggered GSAP motion"})
    prompt = (
        f"Adapt the published Open Design Kinetic Type template at {SOURCE_URL} into a Tayang explainer. "
        "Use the installed starter HTML/GSAP code, preview, and SOURCE-SKILL.md. "
        "Replace its example statements with the user's verified facts, narration beats, timing and aspect ratio. "
        "Keep the typography-led motion and do not treat the source's 15-second promo as the finished video."
    )
    build = "Read STYLE.md and SOURCE-SKILL.md; edit index.html and compositions/main-graphics.html. Install and render with tayang.json."
    with sqlite3.connect(DB, timeout=30) as db:
        if existing:
            db.execute("UPDATE styles SET template=?,preview_url=?,preview_video_url=? WHERE id=?", (meta, asset_url(MEDIA / "poster.png"), asset_url(MEDIA / "preview.mp4"), STYLE_ID))
        else:
            db.execute(
                "INSERT INTO styles (id,name,source,source_url,notes,prompt,created_at,engine,preview_url,preview_video_url,template,version,based_on,build,palette,refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (STYLE_ID, "Kinetic-Type Explainer", "mine", SOURCE_URL, note, prompt,
                 datetime.now(timezone.utc).isoformat(), "hyperframes", asset_url(MEDIA / "poster.png"),
                 asset_url(MEDIA / "preview.mp4"), meta, 1, None, build, "[]", "[]"),
            )
    print(f"Installed Kinetic-Type Explainer: {len(paths)} published files, {len(data)} starter bytes; backup: {backup}")


if __name__ == "__main__":
    main()
