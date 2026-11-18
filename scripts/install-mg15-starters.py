"""Attach the published MG Styles 15 demo code as local Tayang style templates.

Each template is a pinned snapshot of upstream source plus Tayang's render
manifest and a short operational STYLE.md. No video visuals are generated here.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests

MG_COMMIT = "128c083bb0049e901a06af5d0cec3ad3291e8410"
FONTS_COMMIT = "7af0d90b4d532ffa4b041937b560c6df4e7b1e95"
MG_RAW = f"https://raw.githubusercontent.com/Vincentwei1021/mg-styles-15/{MG_COMMIT}"
MG_PAGE = f"https://github.com/Vincentwei1021/mg-styles-15/blob/{MG_COMMIT}"
TREE_URL = f"https://api.github.com/repos/Vincentwei1021/mg-styles-15/git/trees/{MG_COMMIT}?recursive=1"
PAIRS = {
    "flat-vector-pop": "01-flat-vector",
    "gold-line-luxe": "02-line-art",
    "iso-diorama": "03-isometric",
    "soft-3d-candy": "04-3d-render",
    "cel-boil": "05-cel-boil",
    "collage-cutout": "06-collage",
    "liquid-candy": "07-liquid",
    "shape-morph": "08-morph",
    "bauhaus-kinetic": "09-bauhaus",
    "synthwave-vhs": "10-synthwave",
    "aurora-glass": "12-aurora-glass",
    "variety-hanazi": "18-hanazi",
    "sticker-explainer": "19-paperclip",
    "pixel-quest": "20-pixel",
    "cyber-hud-fui": "22-hud",
}
EXTRA = {
    "gold-line-luxe": ["demos/02-line-art/out/timing.json"],
    "soft-3d-candy": ["demos/04-3d-render/out/events.json"],
    "collage-cutout": [
        "assets/textures/grain/grain_film35_2048.png",
        "assets/textures/dust/dust_01_3840x2160.png",
        "assets/textures/dust/dust_03_3840x2160.png",
        "assets/textures/washi/washi_solid_14.png",
        "assets/textures/washi/washi_solid_12.png",
    ],
    "shape-morph": ["assets/textures/paper/Paper001_4K_color.jpg"],
    "aurora-glass": ["assets/textures/grain/grain_fine_2048.png", "demos/12-aurora-glass/out/env.json"],
    "variety-hanazi": ["assets/textures/grain/grain_fine_2048.png"],
}
FONTS = {
    "cel-boil": ("lxgwmarkergothic", "LXGWMarkerGothic-Regular.ttf", "assets/fonts/cjk/lxgwmarkergothic/LXGWMarkerGothic-Regular.ttf"),
    "iso-diorama": ("unbounded", "Unbounded[wght].ttf", "demos/03-isometric/assets/fonts/Unbounded-800-static.ttf"),
    "liquid-candy": ("fraunces", "Fraunces[SOFT,WONK,opsz,wght].ttf", "demos/07-liquid/assets/Fraunces-Liquid-72-900-Soft.ttf"),
    "shape-morph": ("outfit", "Outfit[wght].ttf", "demos/08-morph/assets/fonts/Outfit-SemiBold.ttf"),
    "synthwave-vhs": ("mrdafoe", "MrDafoe-Regular.ttf", "demos/10-synthwave/assets/fonts/MrDafoe-Regular.ttf"),
}
DATA = Path.home() / "AppData/Roaming/app.tayang.studio"
DB = DATA / "tayang.db"
TEMPLATES = DATA / "templates"
BACKUPS = Path.home() / "AppData/Local/Tayang-Backups"


def get(path: str) -> bytes:
    response = requests.get(f"{MG_RAW}/{path}", timeout=90)
    response.raise_for_status()
    return response.content


def style_files(style_id: str, demo: str, tree: list[dict]) -> list[str]:
    prefix = f"demos/{demo}/"
    demo_files = [
        item["path"] for item in tree
        if item["path"].startswith(prefix)
        and item.get("type") == "blob"
        and item.get("mode") == "100644"
        and not any(part in item["path"] for part in ("/out/", "/work/"))
        and not item["path"].endswith("/audio.py")
    ]
    return sorted(set(demo_files + [
        "package.json", "harness/render.mjs", "assets/fonts/fonts.css", "assets/fonts/README.md",
        f"prompts/{demo}.md", "LICENSE",
        *EXTRA.get(style_id, []),
    ]))


def make_zip(style_id: str, demo: str, files: dict[str, bytes]) -> bytes:
    files = dict(files)
    files["assets/fonts/fonts.original.css"] = files["assets/fonts/fonts.css"]
    fallback_css = "/* Upstream omits most font binaries. See fonts.original.css and README.md. */\n"
    if style_id == "cel-boil":
        fallback_css += '@font-face { font-family: "LXGW Marker Gothic"; src: url("/assets/fonts/cjk/lxgwmarkergothic/LXGWMarkerGothic-Regular.ttf") format("truetype"); font-display: block; }\n'
    files["assets/fonts/fonts.css"] = fallback_css.encode("utf-8")
    windows_renderer = """import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const candidates = process.platform === 'win32' ? [
  path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
] : [];
const chrome = process.env.MG_CHROME || candidates.find(existsSync);
const env = chrome ? { ...process.env, MG_CHROME: chrome } : process.env;
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1]) {
  mkdirSync(path.dirname(path.resolve(process.argv[outIndex + 1])), { recursive: true });
}
const child = spawn(process.execPath, [path.join(import.meta.dirname, 'render.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit', env,
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code || 0; });
"""
    guide = f"""# MG Styles 15: {demo}

This starter contains the original published demo source from MG Styles 15 by Vincentwei1021, pinned to commit {MG_COMMIT} (MIT license). Its prompt is in prompts/{demo}.md, the editable film is in demos/{demo}/, and its sample renders with the original harness. The source link is {MG_PAGE}/demos/{demo}.

Run `npm install --ignore-scripts`, then `node harness/tayang-render.mjs demos/{demo} --out renders/sample.mp4 --noaudio` to reproduce the visual example. Tayang's Render command uses the same original renderer through a small wrapper that locates Chrome on Windows and writes a fresh file under renders/.

The original demo is about 10 seconds and may be landscape. For a new Tayang video, edit the demo's index.html and companion source files: replace the example topic, timing and aspect with the project's brief, while retaining the published style's signature visual and motion language. Check the source prompt for detailed techniques, not for its fixed example story.

The upstream project does not distribute its font binaries. This starter bundles the few fonts required to execute this demo, with their OFL notices. It keeps the original font declarations in assets/fonts/fonts.original.css and uses system fallback for the remaining fonts in assets/fonts/fonts.css. To match the original typography, follow assets/fonts/README.md and restore the original CSS after installing the remaining fonts with suitable licenses.

Generate the video's narration through Tayang /voice using the selected voice source. The sample renderer is silent until the project integrates its own audio; update tayang.json or mux the narration into the final MP4. Keep a final render in renders/ and follow AGENTS.md for the project's actual topic and length.
"""
    if style_id == "soft-3d-candy":
        guide += "\nThis demo has an extra Blender dependency. The publisher provides mesh files and Blender scripts, but does not publish its rendered `out/frames/*.png` plates. Before running the browser renderer, generate those plates with Blender 5.1 as described in `demos/04-3d-render/README.md`. The bundled demo video is a visual reference, not an editable replacement for those frames.\n"
    manifest = {
        "engine": "mg-styles-15-browser",
        "install": ["npm", "install", "--ignore-scripts"],
        "render": ["node", "harness/tayang-render.mjs", f"demos/{demo}", "--out", "{output}", "--noaudio"],
    }
    source = {
        "repository": "https://github.com/Vincentwei1021/mg-styles-15",
        "commit": MG_COMMIT,
        "demo": f"{MG_PAGE}/demos/{demo}",
        "prompt": f"{MG_PAGE}/prompts/{demo}.md",
        "fonts": f"https://github.com/google/fonts/tree/{FONTS_COMMIT}/ofl",
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, data in sorted(files.items()):
            archive.writestr(path, data)
        archive.writestr("harness/tayang-render.mjs", windows_renderer)
        archive.writestr("STYLE.md", guide)
        archive.writestr("tayang.json", json.dumps(manifest, indent=2))
        archive.writestr("SOURCE.json", json.dumps(source, indent=2))
    return buffer.getvalue()


def main() -> None:
    with sqlite3.connect(DB) as db:
        rows = {row[0]: row[1] for row in db.execute("SELECT id,template FROM styles WHERE id LIKE 'mg15-%'")}
    pending = {style_id: demo for style_id, demo in PAIRS.items()
        if not rows.get(f"mg15-{style_id}") or json.loads(rows[f"mg15-{style_id}"])["version"] < (6 if style_id in {"aurora-glass", "iso-diorama", "collage-cutout"} else 5)}
    if not pending:
        print("All 15 MG15 styles already have starter templates")
        return
    if len(rows) != len(PAIRS):
        raise RuntimeError("The 15 MG15 styles must be imported first")

    response = requests.get(TREE_URL, timeout=30)
    response.raise_for_status()
    catalog = response.json()
    if catalog.get("truncated"):
        raise RuntimeError("GitHub source tree was truncated")
    tree = catalog["tree"]
    paths = sorted({path for style_id, demo in pending.items() for path in style_files(style_id, demo, tree)})
    with ThreadPoolExecutor(max_workers=8) as pool:
        downloaded = dict(zip(paths, pool.map(get, paths)))
    font_paths = sorted({f"ofl/{FONTS[style_id][0]}/{FONTS[style_id][1]}" for style_id in pending if style_id in FONTS}
        | {f"ofl/{FONTS[style_id][0]}/OFL.txt" for style_id in pending if style_id in FONTS})
    font_base = f"https://raw.githubusercontent.com/google/fonts/{FONTS_COMMIT}"
    def get_font(path: str) -> bytes:
        response = requests.get(f"{font_base}/{path}", timeout=90)
        response.raise_for_status()
        return response.content
    with ThreadPoolExecutor(max_workers=6) as pool:
        font_data = dict(zip(font_paths, pool.map(get_font, font_paths)))
    if not downloaded["LICENSE"].startswith(b"MIT License"):
        raise RuntimeError("The published MIT license was not found")

    prepared = []
    TEMPLATES.mkdir(parents=True, exist_ok=True)
    for style_id, demo in pending.items():
        files = {path: downloaded[path] for path in style_files(style_id, demo, tree)}
        if style_id in FONTS:
            family, name, target = FONTS[style_id]
            files[target] = font_data[f"ofl/{family}/{name}"]
            files[f"FONT-LICENSES/{family}-OFL.txt"] = font_data[f"ofl/{family}/OFL.txt"]
        archive = make_zip(style_id, demo, files)
        digest = hashlib.sha256(archive).hexdigest()
        target = TEMPLATES / f"{digest}.zip"
        part = TEMPLATES / f"{digest}.part"
        part.write_bytes(archive)
        os.replace(part, target)
        meta = json.dumps({"sha256": digest, "size": len(archive), "version": 6 if style_id in {"aurora-glass", "iso-diorama", "collage-cutout"} else 5})
        prepared.append((meta, f"mg15-{style_id}"))
        print(f"Prepared {style_id}: {len(files)} upstream files, {len(archive) / 1048576:.1f} MB", flush=True)

    BACKUPS.mkdir(parents=True, exist_ok=True)
    backup = BACKUPS / f"before-mg15-starters-{datetime.now():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(DB) as original, sqlite3.connect(backup) as copy:
        original.backup(copy)
    with sqlite3.connect(DB, timeout=30) as db:
        db.executemany("UPDATE styles SET template=? WHERE id=?", prepared)
        count = db.execute("SELECT count(*) FROM styles WHERE id LIKE 'mg15-%' AND template IS NOT NULL").fetchone()[0]
        if count != len(PAIRS):
            raise RuntimeError(f"Expected 15 starter templates, found {count}")
    print(f"Attached {len(prepared)} starter templates; database backup: {backup}")


if __name__ == "__main__":
    main()
