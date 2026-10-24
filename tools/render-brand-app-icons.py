#!/usr/bin/env python3
"""Render the existing official FreshWay square SVG artwork into TWA raster icons."""
from pathlib import Path
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
SOURCE_512 = ICONS / "icon-512.svg"
SOURCE_192 = ICONS / "icon-192.svg"

def render(source: Path, destination: Path, size: int) -> None:
    output = destination.with_suffix(".raw.png")
    cairosvg.svg2png(url=str(source), write_to=str(output), output_width=size, output_height=size)
    with Image.open(output) as image:
        image.convert("RGBA").save(destination, format="PNG", optimize=True)
    output.unlink(missing_ok=True)

def main() -> None:
    render(SOURCE_192, ICONS / "icon-192-brand-v2.png", 192)
    render(SOURCE_512, ICONS / "icon-512-brand-v2.png", 512)

    source = SOURCE_512.read_text(encoding="utf-8")
    old = 'width="420" height="204" x="46" y="154"'
    new = 'width="390" height="190" x="61" y="161"'
    if old not in source:
        raise SystemExit("Official FreshWay SVG layout changed; review the maskable safe-area geometry before rendering.")
    maskable = ICONS / "icon-512-maskable-v2.svg"
    maskable.write_text(source.replace(old, new, 1), encoding="utf-8")
    render(maskable, ICONS / "icon-512-maskable-v2.png", 512)
    maskable.unlink()
    for path in [ICONS / "icon-192-brand-v2.png", ICONS / "icon-512-brand-v2.png", ICONS / "icon-512-maskable-v2.png"]:
        with Image.open(path) as image:
            print(f"{path.relative_to(ROOT)}: {image.width}x{image.height}, {path.stat().st_size} bytes")

if __name__ == "__main__":
    main()
