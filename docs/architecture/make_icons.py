#!/usr/bin/env python3
"""Build the rounded icon tiles used by system.py (output: docs/architecture/icons/*.png).

Run once when icons change; the PNGs are committed so system.py renders offline.
Needs `rsvg-convert` and `magick` (Homebrew librsvg / imagemagick). Reads only files in the repo.

Sources, all committed under icons/src (downloaded 2026-10-25):
  icons/src/simple-icons  official brand marks from the simple-icons npm package 16.35.0 (CC0),
                          https://cdn.jsdelivr.net/npm/simple-icons@16.35.0/icons/<slug>.svg
                          (each mark's own brand source is listed in simple-icons' data file)
  icons/src/lucide        generic glyphs from lucide-static 1.61.0 (ISC),
                          https://cdn.jsdelivr.net/npm/lucide-static@1.61.0/icons/<name>.svg
  icons/src/sites/crs.svg CRS site icon, https://crscreditapi.com/favicon.svg
  apps/web/public         Domino mark, Ramp, Capital One, Apify and CREAO logos already used by
                          the app (sources in apps/web/components/icons/README.md)
Brand marks belong to their owners and only identify the product.
"""

import argparse
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "icons" / "src"
PUBLIC = HERE.parents[1] / "apps" / "web" / "public"
SIZE = 256

UI, CONVEX, AGENT, ENGINE, LEARN, SIM = "#111827", "#C2410C", "#0F766E", "#4338CA", "#B45309", "#2563EB"
# (tile name, lucide glyph, tile color)
GENERIC = [
    ("user", "user-round", "#334155"),
    ("dashboard", "layout-dashboard", UI),
    ("worker", "bot-message-square", UI),
    ("brainmap", "brain-circuit", UI),
    ("tools", "plug", UI),
    ("timeline", "messages-square", UI),
    ("customers", "users", UI),
    ("tryit", "flask-conical", UI),
    ("backtest", "history", UI),
    ("queries", "radio", CONVEX),
    ("mutations", "square-pen", CONVEX),
    ("actions", "zap", CONVEX),
    ("http", "webhook", CONVEX),
    ("scheduler", "alarm-clock", CONVEX),
    ("database", "database", CONVEX),
    ("tables", "table-2", CONVEX),
    ("ingest", "file-input", AGENT),
    ("audit", "shield-check", AGENT),
    ("forecast", "trending-up", AGENT),
    ("advisor", "lightbulb", AGENT),
    ("coordinator", "workflow", AGENT),
    ("toolbox", "search", AGENT),
    ("analysis", "sparkles", AGENT),
    ("engine", "calculator", ENGINE),
    ("simulator", "dices", SIM),
    ("decisions", "check-check", LEARN),
    ("rules", "list-checks", LEARN),
    ("delays", "hourglass", LEARN),
    ("learning", "graduation-cap", LEARN),
]
# (tile name, simple-icons slug, tile color, glyph color)
BRANDS = [
    ("stripe", "stripe", "#635BFF", "#FFFFFF"),
    ("hubspot", "hubspot", "#FF7A59", "#FFFFFF"),
    ("quickbooks", "quickbooks", "#2CA01C", "#FFFFFF"),
    ("gusto", "gusto", "#F45D48", "#FFFFFF"),
    ("claude", "claude", "#FFFFFF", "#D97757"),
    ("anthropic", "anthropic", "#F0EEE6", "#191919"),
    ("convex", "convex", "#FFFFFF", "#EE342F"),
    ("nextjs", "nextdotjs", "#000000", "#FFFFFF"),
    ("react", "react", "#20232A", "#61DAFB"),
    ("tailwind", "tailwindcss", "#FFFFFF", "#06B6D4"),
    ("typescript", "typescript", "#FFFFFF", "#3178C6"),
    ("pnpm", "pnpm", "#FFFFFF", "#F69220"),
    ("turborepo", "turborepo", "#FFFFFF", "#FF1E56"),
    ("vitest", "vitest", "#1A1A1A", "#00FF74"),
    ("biome", "biome", "#FFFFFF", "#60A5FA"),
    ("vercel", "vercel", "#000000", "#FFFFFF"),
    ("zod", "zod", "#FFFFFF", "#408AFF"),
]
# (tile name, file, tile color)
LOGOS = [
    ("ramp", PUBLIC / "logos/ramp.png", "#E7F127"),
    ("capitalone", PUBLIC / "logos/capitalone.svg", "#FFFFFF"),
    ("apify", PUBLIC / "logos/apify.svg", "#FFFFFF"),
    ("creao", PUBLIC / "logos/creao.png", "#FFFFFF"),
    ("crs", SRC / "sites/crs.svg", "#FFFFFF"),
]


def tile(body: str, color: str) -> str:
    border = ' stroke="#CBD5E1" stroke-width="6"' if color.upper() == "#FFFFFF" else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
            f'<rect x="6" y="6" width="244" height="244" rx="56" fill="{color}"{border}/>{body}</svg>')


def inner(svg_text: str, attrs: str = "") -> str:
    """Contents and viewBox of an icon, as a nested <svg> filling the tile's middle."""
    view = re.search(r'viewBox="([^"]+)"', svg_text).group(1)
    body = re.sub(r"(?s)^.*?<svg[^>]*>|</svg>\s*$|<title>.*?</title>|<!--.*?-->", "", svg_text)
    return f'<svg x="60" y="60" width="136" height="136" viewBox="{view}"{attrs}>{body}</svg>'


def render(svg: str, out: Path) -> None:
    subprocess.run(["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), "-o", str(out)],
                   input=svg.encode(), check=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--out", type=Path, default=HERE / "icons")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    stroke = ' fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    for name, glyph, color in GENERIC:
        body = inner((SRC / "lucide" / f"{glyph}.svg").read_text(), stroke)
        render(tile(body, color), a.out / f"{name}.png")
    for name, slug, color, ink in BRANDS:
        body = inner((SRC / "simple-icons" / f"{slug}.svg").read_text(), f' fill="{ink}"')
        render(tile(body, color), a.out / f"{name}.png")
    render(tile(inner((PUBLIC / "domino-logo.svg").read_text()), "#E6F4EE"), a.out / "domino.png")
    for name, src, color in LOGOS:
        out = a.out / f"{name}.png"
        if src.suffix == ".svg":
            render(tile(inner(src.read_text()), color), out)
        else:  # raster logo: shrink onto the tile
            render(tile("", color), out)
            subprocess.run(["magick", str(out), "(", str(src), "-resize", "176x176", ")",
                            "-gravity", "center", "-composite", str(out)], check=True)
    print(f"{len(list(a.out.glob('*.png')))} tiles in {a.out}")


if __name__ == "__main__":
    main()
