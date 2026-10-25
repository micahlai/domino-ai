#!/usr/bin/env python3
"""Domino system architecture slide (v4), hand-laid at 1920 x 1080.

Run:  python3 docs/architecture/slide.py
  -> docs/architecture/domino-system.svg   (self-contained: logos embedded)
  -> docs/architecture/domino-system.png   (3840 x 2160, rendered by headless Google Chrome)

Standard library only. Every card, logo and arrow sits on exact coordinates in this file; no
automatic layout. Logos come from icons/src (simple-icons 16.35.0, lucide-static 1.61.0, CRS
site icon) and apps/web/public/logos (Ramp, Capital One, Apify, CREAO), as listed in
make_icons.py. Reads no credentials or product data.

Facts were checked against main (fe1fbad, 2026-10-25): pages from
apps/web/components/AppShell.tsx; agents from convex/fieldAudit.ts, fieldAnalyst.ts,
fieldAdvisor.ts, fieldCoordinator.ts, fieldAi.ts (CREAO first, Claude fallback), fieldApify.ts;
identity and fraud checks from convex/fieldCrs.ts; learning from convex/fieldLearning.ts
(flag and fix decisions become scoped rules that later audit and advisor runs apply) and
recurring-revenue.ts (per-customer payment delays feed the forecast).
"""

from __future__ import annotations

import base64
import re
import shutil
import subprocess
import tempfile
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "icons" / "src"
PUBLIC = HERE.parents[1] / "apps" / "web" / "public"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

W, H = 1920, 1080
FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif"

BG = "#FAFAF9"
CARD = "#FFFFFF"
LINE = "#E7E5E4"
INK = "#1C1917"
MUTED = "#57534E"
SOFT = "#A8A29E"
ARROW = "#A8A29E"
LOOP = "#F97316"

# One accent per column.
BLUE, RED, VIOLET, GREEN, SLATE = "#2563EB", "#DC2626", "#7C3AED", "#059669", "#475569"
TINT = {BLUE: "#EFF6FF", RED: "#FEF2F2", VIOLET: "#F5F3FF", GREEN: "#ECFDF5", SLATE: "#F5F5F4"}

# Columns: x, width.
COLS = {"sources": (64, 280), "convex": (447, 400), "engine": (950, 280),
        "app": (1333, 280), "people": (1716, 140)}
TOP, BOTTOM = 232, 880

# simple-icons slug -> brand color
BRANDS = {"stripe": "#635BFF", "quickbooks": "#2CA01C", "gusto": "#F45D48", "hubspot": "#FF7A59",
          "convex": "#EE342F", "nextdotjs": "#000000", "react": "#149ECA", "tailwindcss": "#06B6D4",
          "typescript": "#3178C6", "pnpm": "#F69220", "turborepo": "#FF1E56", "vitest": "#3FB950",
          "biome": "#60A5FA", "vercel": "#000000", "claude": "#D97757", "zod": "#408AFF"}


# ---------- assets ----------

def _svg_parts(text: str) -> tuple[str, str]:
    view = re.search(r'viewBox="([^"]+)"', text).group(1)
    body = re.sub(r"(?s)^.*?<svg[^>]*>|</svg>\s*$|<title>.*?</title>|<!--.*?-->", "", text)
    return view, body


def brand(slug: str, x: float, y: float, size: float) -> str:
    view, body = _svg_parts((SRC / "simple-icons" / f"{slug}.svg").read_text())
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{view}" '
            f'fill="{BRANDS[slug]}">{body}</svg>')


def logo_file(path: Path, x: float, y: float, size: float) -> str:
    if path.suffix == ".png":
        data = base64.b64encode(path.read_bytes()).decode()
        return (f'<image x="{x}" y="{y}" width="{size}" height="{size}" '
                f'href="data:image/png;base64,{data}"/>')
    view, body = _svg_parts(path.read_text())
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{view}">{body}</svg>'


LOGOS = {"ramp": PUBLIC / "logos/ramp.png", "capitalone": PUBLIC / "logos/capitalone.svg",
         "apify": PUBLIC / "logos/apify.svg", "creao": PUBLIC / "logos/creao.png",
         "crs": SRC / "sites/crs.svg"}


def mark(name: str, x: float, y: float, size: float) -> str:
    """Any logo by short name, drawn in a size x size square."""
    if name in LOGOS:
        return logo_file(LOGOS[name], x, y, size)
    return brand(name, x, y, size)


def glyph(name: str, x: float, y: float, size: float, color: str) -> str:
    view, body = _svg_parts((SRC / "lucide" / f"{name}.svg").read_text())
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="{view}" fill="none" '
            f'stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            f'{body}</svg>')


# ---------- primitives ----------

def t(x: float, y: float, s: str, size: float = 18, color: str = INK, weight: int = 400,
      anchor: str = "start", spacing: float = 0) -> str:
    ls = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" '
            f'text-anchor="{anchor}"{ls}>{escape(s)}</text>')


def card(x: float, y: float, w: float, h: float, fill: str = CARD, stroke: str = LINE) -> str:
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="1" filter="url(#soft)"/>')


def chip(x: float, y: float, w: float, h: float, color: str) -> str:
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{TINT[color]}"/>'


def icon_tile(name: str, x: float, y: float, color: str, size: float = 40) -> str:
    """A tinted rounded square with a line glyph, for concepts that have no brand logo."""
    pad = size * 0.22
    return (f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="11" fill="{TINT[color]}"/>'
            + glyph(name, x + pad, y + pad, size - 2 * pad, color))


def column_head(key: str, label: str, color: str, logos: tuple[str, ...] = ()) -> str:
    x, _ = COLS[key]
    out = f'<circle cx="{x + 6}" cy="{TOP - 30}" r="5" fill="{color}"/>'
    out += t(x + 20, TOP - 23, label.upper(), 17, color, 700, spacing=1.6)
    lx = x + 30 + len(label) * 13.4
    for name in logos:
        out += mark(name, lx, TOP - 41, 22)
        lx += 30
    return out


def item(x: float, y: float, tile: str, title: str, note: str, color: str,
         logo: str | None = None) -> str:
    """Icon or logo on the left, a title and one muted line on the right."""
    out = mark(logo, x + 2, y + 2, 36) if logo else icon_tile(tile, x, y, color)
    out += t(x + 54, y + 17, title, 20, INK, 600)
    if note:
        out += t(x + 54, y + 40, note, 17, MUTED)
    return out


def arrow(x1: float, y: float, x2: float, label: str, both: bool = False) -> str:
    """One horizontal arrow across a column gap, with a short label above it."""
    out = (f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{ARROW}" stroke-width="2.5" '
           f'marker-end="url(#head)"' + (' marker-start="url(#tail)"' if both else "") + '/>')
    lines = label.split("\n")
    cx = (x1 + x2) / 2
    for i, line in enumerate(lines):
        out += t(cx, y - 14 - (len(lines) - 1 - i) * 20, line, 16, MUTED, 600, "middle")
    return out


# ---------- slide ----------

def slide() -> str:
    parts: list[str] = []
    add = parts.append

    # Title.
    add(t(64, 84, "How Domino works", 46, INK, 700, spacing=-0.5))
    add(t(64, 124, "Books and bank data in, a 13-week cash forecast and suggested fixes out. "
                   "A person approves every action; Domino never moves money.", 22, MUTED))

    # 1. Sources.
    x, w = COLS["sources"]
    add(column_head("sources", "Sources", BLUE))
    add(card(x, TOP, w, 300))
    add(t(x + 24, TOP + 40, "Mock vendor APIs", 21, INK, 650))
    add(t(x + 24, TOP + 66, "simulator-generated books", 17, MUTED))
    vendors = [("stripe", "Stripe"), ("ramp", "Ramp"), ("quickbooks", "QuickBooks"),
               ("gusto", "Gusto"), ("hubspot", "HubSpot")]
    for i, (name, label) in enumerate(vendors):
        cx = x + 24 + (i % 3) * 84
        cy = TOP + 94 + (i // 3) * 100
        add(f'<rect x="{cx}" y="{cy}" width="64" height="64" rx="14" fill="#FFFFFF" '
            f'stroke="{LINE}"/>')
        add(mark(name, cx + 14, cy + 14, 36))
        add(t(cx + 32, cy + 86, label, 15, MUTED, 500, "middle"))
    add(card(x, TOP + 324, w, 196))
    add(t(x + 24, TOP + 364, "Real sandboxes", 21, INK, 650))
    add(item(x + 24, TOP + 392, "", "Capital One", "Nessie bank", BLUE, logo="capitalone"))
    add(item(x + 24, TOP + 452, "", "CRS", "identity + fraud", BLUE, logo="crs"))

    # 2. Convex backend.
    x, w = COLS["convex"]
    add(column_head("convex", "Convex backend", RED, ("convex",)))
    add(card(x, TOP, w, 346))
    add(t(x + 24, TOP + 38, "Agents", 21, INK, 650))
    add(t(x + w - 24, TOP + 38, "Convex actions", 17, SOFT, 400, "end"))
    agents = [("file-input", "Ingestion", "maps every tool"),
              ("shield-check", "Audit swarm", "7 checks + CRS"),
              ("trending-up", "Forecasting", "stress scenarios"),
              ("lightbulb", "Advisors", "compare fixes")]
    for i, (tile, title, note) in enumerate(agents):
        ax = x + 24 + (i % 2) * 192
        ay = TOP + 64 + (i // 2) * 84
        add(item(ax, ay, tile, title, note, RED))
    add(f'<rect x="{x + 24}" y="{TOP + 240}" width="{w - 48}" height="82" rx="12" '
        f'fill="#FFF7ED" stroke="#FED7AA"/>')
    add(f'<rect x="{x + 40}" y="{TOP + 261}" width="40" height="40" rx="11" fill="#FFEDD5"/>')
    add(glyph("list-checks", x + 49, TOP + 270, 22, LOOP))
    add(t(x + 96, TOP + 277, "Learned rules", 20, INK, 600))
    add(t(x + 96, TOP + 300, "scoped · versioned · revocable", 17, MUTED))

    add(card(x, TOP + 366, w, 92))
    add(t(x + 24, TOP + 402, "Triggers", 21, INK, 650))
    add(icon_tile("webhook", x + 24, TOP + 414, RED, 30))
    add(t(x + 62, TOP + 436, "signed webhooks", 17, MUTED))
    add(icon_tile("alarm-clock", x + 216, TOP + 414, RED, 30))
    add(t(x + 254, TOP + 436, "sim clock", 17, MUTED))

    add(card(x, TOP + 478, w, 170))
    add(t(x + 24, TOP + 516, "Storage + realtime", 21, INK, 650))
    for i, (tile, label) in enumerate([("table-2", "Tables"), ("square-pen", "Mutations"),
                                       ("radio", "Live queries")]):
        sx = x + 24 + i * 124
        add(icon_tile(tile, sx, TOP + 542, RED, 40))
        add(t(sx, TOP + 612, label, 17, MUTED))

    # 3. Engine + AI.
    x, w = COLS["engine"]
    add(column_head("engine", "Engine + AI", VIOLET))
    add(card(x, TOP, w, 300))
    add(mark("typescript", x + 24, TOP + 18, 26))
    add(t(x + 60, TOP + 40, "Engine", 21, INK, 650))
    add(t(x + w - 24, TOP + 40, "pure, no AI", 17, SOFT, 400, "end"))
    add(item(x + 24, TOP + 64, "calculator", "Cash engine", "13-week forecast", VIOLET))
    add(item(x + 24, TOP + 140, "calculator", "Risk engine", "dominoes · stress tests", VIOLET))
    add(f'<rect x="{x + 24}" y="{TOP + 214}" width="{w - 48}" height="62" rx="12" '
        f'fill="#FFF7ED" stroke="#FED7AA"/>')
    add(glyph("hourglass", x + 38, TOP + 231, 26, LOOP))
    add(t(x + 76, TOP + 240, "payment history →", 17, MUTED))
    add(t(x + 76, TOP + 262, "learned delays", 17, INK, 600))

    add(card(x, TOP + 324, w, 244))
    add(t(x + 24, TOP + 362, "AI providers", 21, INK, 650))
    add(item(x + 24, TOP + 384, "", "CREAO", "primary agents", VIOLET, logo="creao"))
    add(item(x + 24, TOP + 444, "", "Claude", "fallback · Ask Domino", VIOLET, logo="claude"))
    add(item(x + 24, TOP + 504, "", "Apify", "web search tool", VIOLET, logo="apify"))

    # 4. App.
    x, w = COLS["app"]
    add(column_head("app", "App", GREEN, ("nextdotjs", "react", "tailwindcss")))
    add(card(x, TOP, w, 648))
    pages = [("layout-dashboard", "Dashboard", "cash at a glance"),
             ("bot-message-square", "Worker", "fixes · flags · learned"),
             ("users", "Customers", "payment behavior + risk"),
             ("brain-circuit", "Brain map", "agents at work"),
             ("messages-square", "Timeline", "scenarios · Ask Domino"),
             ("flask-conical", "Try it", "judge sandbox · 2U")]
    for i, (tile, title, note) in enumerate(pages):
        add(item(x + 24, TOP + 28 + i * 104, tile, title, note, GREEN))

    # 5. People.
    x, w = COLS["people"]
    add(column_head("people", "People", SLATE))
    add(card(x, TOP + 230, w, 200))
    add(icon_tile("user-round", x + w / 2 - 30, TOP + 258, SLATE, 60))
    add(t(x + w / 2, TOP + 354, "Finance lead", 20, INK, 600, "middle"))
    add(t(x + w / 2, TOP + 378, "or judge,", 17, MUTED, 400, "middle"))
    add(t(x + w / 2, TOP + 402, "in a browser", 17, MUTED, 400, "middle"))

    # Arrows: one per column transition.
    sx, sw = COLS["sources"]
    cx, cw = COLS["convex"]
    ex, ew = COLS["engine"]
    ax, aw = COLS["app"]
    px, _ = COLS["people"]
    add(arrow(sx + sw + 10, TOP + 150, cx - 12, "books\n+ bank"))
    add(arrow(cx + cw + 10, TOP + 150, ex - 12, "scenarios /\nexplanations", both=True))
    add(arrow(cx + cw + 10, TOP + 606, ax - 12, "live updates"))
    add(arrow(px - 10, TOP + 330, ax + aw + 12, "review\n& decide"))

    # Learning loop: from People, over the top, back into the Agents card.
    lx0, ly0 = px + 116, TOP + 230
    lx1, ly1 = cx + cw - 64, TOP
    ly = TOP - 62
    r = 18
    add(f'<path d="M {lx0} {ly0} L {lx0} {ly + r} Q {lx0} {ly} {lx0 - r} {ly} L {lx1 + r} {ly} '
        f'Q {lx1} {ly} {lx1} {ly + r} L {lx1} {ly1 - 3}" fill="none" stroke="{LOOP}" '
        f'stroke-width="3" marker-end="url(#loop)"/>')
    mid = (lx0 + lx1) / 2
    add(f'<rect x="{mid - 230}" y="{ly - 18}" width="460" height="36" rx="18" fill="#FFF7ED" '
        f'stroke="#FDBA74"/>')
    add(t(mid, ly + 6, "Learning loop · approvals & dismissals become rules", 17, "#C2410C",
          650, "middle"))

    # Tech stack strip.
    add(f'<line x1="64" y1="952" x2="{W - 64}" y2="952" stroke="{LINE}"/>')
    add(t(64, 1012, "BUILT WITH", 15, SOFT, 700, spacing=1.6))
    stack = [("nextdotjs", "Next.js 16"), ("react", "React 19"), ("tailwindcss", "Tailwind"),
             ("typescript", "TypeScript"), ("convex", "Convex"), ("vercel", "Vercel"),
             ("pnpm", "pnpm"), ("turborepo", "Turborepo"), ("vitest", "Vitest"),
             ("biome", "Biome"), ("claude", "Claude"), ("creao", "CREAO"), ("apify", "Apify"),
             ("capitalone", "Nessie"), ("crs", "CRS")]
    widths = [34 + len(label) * 8.9 for _, label in stack]
    gap = (W - 64 - 196 - sum(widths)) / (len(stack) - 1)
    sx = 196
    for (name, label), width in zip(stack, widths):
        add(mark(name, sx, 990, 26))
        add(t(sx + 34, 1010, label, 16, MUTED, 500))
        sx += width + gap

    defs = (f'<defs>'
            f'<filter id="soft" x="-5%" y="-5%" width="110%" height="115%">'
            f'<feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#1C1917" '
            f'flood-opacity="0.05"/></filter>'
            f'<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{ARROW}"/></marker>'
            f'<marker id="tail" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{ARROW}"/></marker>'
            f'<marker id="loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
            f'markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{LOOP}"/></marker>'
            f'</defs>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">'
            f'{defs}<rect width="{W}" height="{H}" fill="{BG}"/>{"".join(parts)}</svg>')


def render_png(svg: Path, png: Path) -> None:
    """Screenshot the SVG at 2x with headless Chrome (sharp text, real system fonts)."""
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "slide.html"
        page.write_text(f'<!doctype html><html><body style="margin:0;background:{BG}">'
                        f'{svg.read_text()}</body></html>')
        shot = Path(tmp) / "shot.png"
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size={W},{H}", "--force-device-scale-factor=2",
                        f"--screenshot={shot}", page.as_uri()],
                       check=True, capture_output=True)
        shutil.move(shot, png)


def main() -> None:
    svg = HERE / "domino-system.svg"
    svg.write_text(slide())
    render_png(svg, HERE / "domino-system.png")
    print(svg)
    print(HERE / "domino-system.png")


if __name__ == "__main__":
    main()
