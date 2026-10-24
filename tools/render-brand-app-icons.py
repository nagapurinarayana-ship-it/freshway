#!/usr/bin/env python3
"""Render branded raster icons from the checked-in FreshWay master logo."""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
LOGO = ROOT / "freshway-logo-master.webp"

def render(destination: Path, size: int, logo_width: int, logo_height: int, x: int, y: int) -> None:
    with Image.open(LOGO) as source:
        logo = source.convert("RGB")
    logo.thumbnail((logo_width, logo_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), "white")
    # Use the actual, valid master-logo bitmap. No malformed embedded SVG/JPEG payload.
    offset_x = x + max(0, (logo_width - logo.width) // 2)
    offset_y = y + max(0, (logo_height - logo.height) // 2)
    canvas.paste(logo, (offset_x, offset_y))
    canvas.save(destination, format="PNG", optimize=True)
    with Image.open(destination) as check:
        check.verify()
    with Image.open(destination) as check:
        print(f"{destination.relative_to(ROOT)}: {check.width}x{check.height}, {destination.stat().st_size} bytes")

def main() -> None:
    if not LOGO.is_file() or LOGO.stat().st_size < 100:
        raise SystemExit("The checked-in FreshWay master logo is missing or invalid.")
    render(ICONS / "icon-192-brand-v2.png", 192, 158, 78, 17, 57)
    render(ICONS / "icon-512-brand-v2.png", 512, 420, 204, 46, 154)
    render(ICONS / "icon-512-maskable-v2.png", 512, 390, 190, 61, 161)

if __name__ == "__main__":
    main()
