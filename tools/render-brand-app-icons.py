#!/usr/bin/env python3
"""Render the existing official FreshWay square SVG artwork into TWA raster icons."""
from pathlib import Path
import base64
import re
import cairosvg
from PIL import Image, ImageFile

# Match the browser's tolerant rendering of the embedded logo JPEG.
ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
SOURCE_512 = ICONS / "icon-512.svg"
SOURCE_192 = ICONS / "icon-192.svg"

def normalized_svg(path: Path) -> str:
    source = path.read_text(encoding="utf-8")
    match = re.search(r'data:image/jpeg;base64,([^"]+)', source)
    if not match:
        raise SystemExit(f"{path.name} is missing the embedded FreshWay artwork.")
    payload = match.group(1)
    payload += "=" * ((4 - len(payload) % 4) % 4)
    # Browsers tolerate the artwork's missing base64 padding; strict renderers do not.
    base64.b64decode(payload, validate=True)
    return source[:match.start(1)] + payload + source[match.end(1):]

def render(source: str, destination: Path, size: int) -> None:
    output = destination.with_suffix(".raw.png")
    cairosvg.svg2png(bytestring=source.encode("utf-8"), write_to=str(output), output_width=size, output_height=size)
    with Image.open(output) as image:
        image.convert("RGB").quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(destination, format="PNG", optimize=True)
    output.unlink(missing_ok=True)

def main() -> None:
    source_192 = normalized_svg(SOURCE_192)
    source_512 = normalized_svg(SOURCE_512)
    render(source_192, ICONS / "icon-192-brand-v2.png", 192)
    render(source_512, ICONS / "icon-512-brand-v2.png", 512)

    old = 'width="420" height="204" x="46" y="154"'
    new = 'width="390" height="190" x="61" y="161"'
    if old not in source_512:
        raise SystemExit("Official FreshWay SVG layout changed; review the maskable safe-area geometry before rendering.")
    render(source_512.replace(old, new, 1), ICONS / "icon-512-maskable-v2.png", 512)
    for path in [ICONS / "icon-192-brand-v2.png", ICONS / "icon-512-brand-v2.png", ICONS / "icon-512-maskable-v2.png"]:
        with Image.open(path) as image:
            print(f"{path.relative_to(ROOT)}: {image.width}x{image.height}, {path.stat().st_size} bytes")

if __name__ == "__main__":
    main()
