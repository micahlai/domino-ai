#!/usr/bin/env python3
"""Build the rounded icon tiles used by system.py (output: docs/architecture/icons/*.png).

Run once when icons change; the PNGs are committed so system.py renders offline.
Needs `rsvg-convert` and `magick` (Homebrew librsvg / imagemagick).

Sources (same marks the app uses, see apps/web/components/icons/README.md):
  --simple-icons DIR  SVGs from the simple-icons npm package 16.35.0 (CC0):
                      stripe, hubspot, quickbooks, gusto, claude
  --lucide DIR        SVGs from the lucide-static npm package 1.61.0 (ISC) for generic glyphs
  apps/web/public     Domino mark, Ramp, Capital One, Apify and CREAO logos (already in the repo)
There is no official Convex mark in either package, so Convex parts use generic glyphs.
"""

import argparse
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parents[1] / "apps" / "web" / "public"
SIZE = 256

# (tile name, lucide glyph, tile color)
GENERIC = [
    ("user", "user-round", "#334155"),
    ("dashboard", "layout-dashboard", "#111827"),
    ("worker", "bot-message-square", "#111827"),
    ("brainmap", "brain-circuit", "#111827"),
    ("tools", "plug", "#111827"),
    ("timeline", "messages-square", "#111827"),
    ("tryit", "flask-conical", "#111827"),
    ("backtest", "history", "#111827"),
    ("queries", "radio", "#C2410C"),
    ("mutations", "square-pen", "#C2410C"),
    ("actions", "zap", "#C2410C"),
    ("http", "webhook", "#C2410C"),
    ("scheduler", "alarm-clock", "#C2410C"),
    ("database", "database", "#C2410C"),
    ("ingest", "file-input", "#0F766E"),
    ("audit", "shield-check", "#0F766E"),
    ("forecast", "trending-up", "#0F766E"),
    ("advisor", "lightbulb", "#0F766E"),
    ("coordinator", "workflow", "#0F766E"),
    ("toolbox", "search", "#0F766E"),
    ("analysis", "sparkles", "#0F766E"),
    ("engine", "calculator", "#4338CA"),
    ("simulator", "dices", "#2563EB"),
]
# (tile name, simple-icons slug, tile color, glyph color)
BRANDS = [
    ("stripe", "stripe", "#635BFF", "#FFFFFF"),
    ("hubspot", "hubspot", "#FF7A59", "#FFFFFF"),
    ("quickbooks", "quickbooks", "#2CA01C", "#FFFFFF"),
    ("gusto", "gusto", "#F45D48", "#FFFFFF"),
    ("claude", "claude", "#FFFFFF", "#D97757"),
]
# (tile name, file in apps/web/public, tile color)
LOGOS = [
    ("ramp", "logos/ramp.png", "#E7F127"),
    ("capitalone", "logos/capitalone.svg", "#FFFFFF"),
    ("apify", "logos/apify.svg", "#FFFFFF"),
    ("creao", "logos/creao.png", "#FFFFFF"),
]


def tile(body: str, color: str) -> str:
    border = ' stroke="#CBD5E1" stroke-width="6"' if color.upper() == "#FFFFFF" else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
            f'<rect x="6" y="6" width="244" height="244" rx="56" fill="{color}"{border}/>{body}</svg>')


def inner(svg_text: str) -> str:
    """Contents and viewBox of a downloaded icon, as a nested <svg> filling the tile's middle."""
    view = re.search(r'viewBox="([^"]+)"', svg_text).group(1)
    body = re.sub(r"(?s)^.*?<svg[^>]*>|</svg>\s*$|<title>.*?</title>|<!--.*?-->", "", svg_text)
    return f'<svg x="60" y="60" width="136" height="136" viewBox="{view}"{{attrs}}>{body}</svg>'


def render(svg: str, out: Path) -> None:
    subprocess.run(["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", str(out)],
                   input=svg.encode(), check=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--simple-icons", type=Path, required=True)
    p.add_argument("--lucide", type=Path, required=True)
    p.add_argument("--out", type=Path, default=HERE / "icons")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    for name, glyph, color in GENERIC:
        body = inner((a.lucide / f"{glyph}.svg").read_text())
        attrs = ' fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
        render(tile(body.replace("{attrs}", attrs), color), a.out / f"{name}.png")
    for name, slug, color, ink in BRANDS:
        body = inner((a.simple_icons / f"{slug}.svg").read_text())
        render(tile(body.replace("{attrs}", f' fill="{ink}"'), color), a.out / f"{name}.png")
    domino = inner((PUBLIC / "domino-logo.svg").read_text()).replace("{attrs}", "")
    render(tile(domino, "#E6F4EE"), a.out / "domino.png")
    for name, rel, color in LOGOS:
        src = PUBLIC / rel
        if src.suffix == ".svg":
            body = inner(src.read_text()).replace("{attrs}", "")
            render(tile(body, color), a.out / f"{name}.png")
        else:  # raster logo: shrink onto the tile
            base = a.out / f"{name}.png"
            render(tile("", color), base)
            subprocess.run(["magick", str(base), "(", str(src), "-resize", "176x176", ")",
                            "-gravity", "center", "-composite", str(base)], check=True)
    for path in sorted(a.out.glob("*.png")):
        print(path)


if __name__ == "__main__":
    main()
