#!/usr/bin/env python3
"""Domino system architecture slide (v5), hand-laid at 1920 x 1080.

Run:  python3 docs/architecture/slide.py
  -> docs/architecture/domino-system.svg   (self-contained: logos embedded)
  -> docs/architecture/domino-system.png   (3840 x 2160, rendered by headless Google Chrome)

Standard library only. Every card, logo and arrow sits on exact coordinates in this file; no
automatic layout. Arrows are right-angle paths colored by flow (blue data in, purple AI calls,
green results to the UI, orange learning loop) and never pass through a card. Logos come from icons/src (simple-icons 16.35.0, lucide-static 1.61.0, CRS
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


# Flow colors (legend): data in, AI calls, results to the UI, learning loop.
DATA, AIC, RES = "#2563EB", "#7C3AED", "#16A34A"
FLOWS = {DATA: "data", AIC: "ai", RES: "res", LOOP: "loop"}


def flow(points: list[tuple[float, float]], color: str, label: str = "",
         at: tuple[float, float] | None = None, both: bool = False, dashed: bool = False,
         r: float = 10) -> str:
    """A right-angle path with rounded corners, an arrowhead and an optional label pill."""
    d = f"M {points[0][0]} {points[0][1]}"
    for (ax, ay), (bx, by), (cx, cy) in zip(points, points[1:], points[2:]):
        def toward(px, py, qx, qy, k):
            n = max(abs(qx - px) + abs(qy - py), 1e-9)
            k = min(k, n / 2)
            return px + (qx - px) / n * k, py + (qy - py) / n * k
        p1 = toward(bx, by, ax, ay, r)
        p2 = toward(bx, by, cx, cy, r)
        d += f" L {p1[0]:.1f} {p1[1]:.1f} Q {bx} {by} {p2[0]:.1f} {p2[1]:.1f}"
    d += f" L {points[-1][0]} {points[-1][1]}"
    key = FLOWS[color]
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    start = f' marker-start="url(#s-{key})"' if both else ""
    out = (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.4" '
           f'stroke-linejoin="round"{dash}{start} marker-end="url(#e-{key})"/>')
    if label:
        out += pill(at[0], at[1], label, color)
    return out


def pill(cx: float, cy: float, label: str, color: str) -> str:
    """Edge label on a small background pill so it reads cleanly over lines and borders."""
    lines = label.split("\n")
    width = max(len(s) for s in lines) * 8.3 + 16
    height = 21 * len(lines) + 4
    out = (f'<rect x="{cx - width / 2:.1f}" y="{cy - height / 2:.1f}" width="{width:.1f}" '
           f'height="{height}" rx="8" fill="{BG}" fill-opacity="0.96"/>')
    for i, line in enumerate(lines):
        y = cy - height / 2 + 17 + i * 21
        out += t(cx, y, line, 16, color, 600, "middle")
    return out


def legend(x: float, y: float) -> str:
    out = ""
    for color, label in [(DATA, "data in"), (AIC, "AI calls"), (RES, "results to the UI"),
                         (LOOP, "learning loop")]:
        out += (f'<line x1="{x}" y1="{y - 6}" x2="{x + 26}" y2="{y - 6}" stroke="{color}" '
                f'stroke-width="3" stroke-linecap="round"/>')
        out += t(x + 34, y, label, 17, MUTED, 500)
        x += 34 + len(label) * 8.2 + 26
    return out


# ---------- slide ----------

def slide() -> str:
    parts: list[str] = []
    add = parts.append

    # Title and legend.
    add(t(64, 84, "How Domino works", 46, INK, 700, spacing=-0.5))
    add(t(64, 124, "Books and bank data in, a 13-week cash forecast and suggested fixes out. "
                   "A person approves every action; Domino never moves money.", 22, MUTED))
    add(legend(1262, 80))

    # 1. Sources.
    x, w = COLS["sources"]
    add(column_head("sources", "Sources", BLUE))
    add(card(x, TOP, w, 270))
    add(t(x + 24, TOP + 38, "Mock vendor APIs", 21, INK, 650))
    add(t(x + 24, TOP + 62, "simulator-generated books", 17, MUTED))
    vendors = [("stripe", "Stripe"), ("ramp", "Ramp"), ("quickbooks", "QuickBooks"),
               ("gusto", "Gusto"), ("hubspot", "HubSpot")]
    bus_x = x + w - 26
    for i, (name, label) in enumerate(vendors):
        vy = TOP + 84 + i * 36
        add(mark(name, x + 24, vy, 26))
        add(t(x + 60, vy + 19, label, 18, INK, 500))
        if i < len(vendors) - 1:       # the last row is the start of the bus path itself
            add(f'<path d="M {x + 170} {vy + 13} L {bus_x - 10} {vy + 13} Q {bus_x} {vy + 13} '
                f'{bus_x} {vy + 3}" fill="none" stroke="{DATA}" stroke-width="2.4"/>')
    bus_y = TOP + 84 + (len(vendors) - 1) * 36 + 13
    add(card(x, TOP + 290, w, 200))
    add(t(x + 24, TOP + 328, "Real sandboxes", 21, INK, 650))
    add(item(x + 24, TOP + 352, "", "Capital One", "Nessie bank", BLUE, logo="capitalone"))
    add(item(x + 24, TOP + 422, "", "CRS", "identity + fraud", BLUE, logo="crs"))

    # 2. Convex backend.
    x, w = COLS["convex"]
    add(column_head("convex", "Convex backend", RED, ("convex",)))
    add(card(x, TOP, 196, 98))
    add(t(x + 20, TOP + 30, "Triggers", 19, INK, 650))
    add(icon_tile("webhook", x + 20, TOP + 42, RED, 24))
    add(t(x + 52, TOP + 60, "webhooks", 16, MUTED))
    add(icon_tile("alarm-clock", x + 20, TOP + 70, RED, 24))
    add(t(x + 52, TOP + 88, "sim clock", 16, MUTED))

    ay0 = TOP + 118                      # agents card top
    add(card(x, ay0, w, 354))
    add(t(x + 64, ay0 + 36, "Agents", 21, INK, 650))
    rows = {"ingest": ay0 + 54, "audit": ay0 + 132, "forecast": ay0 + 210, "advisors": ay0 + 288}
    add(item(x + 24, rows["ingest"], "file-input", "Ingestion", "maps every tool", RED))
    add(item(x + 24, rows["audit"], "shield-check", "Audit swarm", "7 checks + CRS", RED))
    add(item(x + 24, rows["forecast"], "trending-up", "Forecasting", "stress scenarios", RED))
    add(item(x + 24, rows["advisors"], "lightbulb", "Advisors", "compare fixes", RED))
    cx_ = x + 44                         # pipeline arrows run down the icon column
    pipeline = [("ingest", "audit", "snapshot"), ("audit", "forecast", "checked books"),
                ("forecast", "advisors", "cash gaps")]
    for a, b, label in pipeline:
        add(flow([(cx_, rows[a] + 42), (cx_, rows[b] - 2)], DATA))
        add(t(cx_ + 14, rows[a] + 66, label, 15, DATA, 600))
    # Learned rules chip, top right of the agents card.
    lr = (x + 236, ay0 + 22, 140, 86)
    add(f'<rect x="{lr[0]}" y="{lr[1]}" width="{lr[2]}" height="{lr[3]}" rx="12" '
        f'fill="#FFF7ED" stroke="#FDBA74"/>')
    add(glyph("list-checks", lr[0] + 12, lr[1] + 12, 20, LOOP))
    add(t(lr[0] + 38, lr[1] + 28, "Learned rules", 16, INK, 650))
    add(t(lr[0] + 12, lr[1] + 52, "scoped · versioned", 14, MUTED))
    add(t(lr[0] + 12, lr[1] + 72, "revocable", 14, MUTED))
    add(flow([(lr[0] + 30, lr[1] + lr[3]), (lr[0] + 30, rows["audit"] + 14),
              (x + 212, rows["audit"] + 14)], LOOP, "next run", (lr[0] + 70, rows["audit"] - 8)))

    sy0 = ay0 + 374                      # storage card top
    add(card(x, sy0, w, BOTTOM - sy0))
    add(t(x + w - 24, sy0 + 34, "Storage + realtime", 21, INK, 650, "end"))
    store = [("square-pen", "Mutations"), ("table-2", "Tables"), ("radio", "Live queries")]
    for i, (tile, label) in enumerate(store):
        sx = x + 24 + i * 136
        add(icon_tile(tile, sx, sy0 + 74, RED, 42))
        add(t(sx + 21, sy0 + 140, label, 16, MUTED, 500, "middle"))
    add(flow([(x + 70, sy0 + 95), (x + 156, sy0 + 95)], RES, "write", (x + 113, sy0 + 76)))
    add(flow([(x + 206, sy0 + 95), (x + 292, sy0 + 95)], RES, "push", (x + 249, sy0 + 76)))

    # 3. Engine + AI.
    ex, ew = COLS["engine"]
    add(column_head("engine", "Engine + AI", VIOLET))
    add(card(ex, TOP, ew, 268))
    add(mark("typescript", ex + 24, TOP + 18, 26))
    add(t(ex + 60, TOP + 40, "Engine", 21, INK, 650))
    add(t(ex + ew - 24, TOP + 40, "pure, no AI", 17, SOFT, 400, "end"))
    cash_y, risk_y = TOP + 62, TOP + 190
    add(item(ex + 24, cash_y, "calculator", "Cash engine", "13-week forecast", VIOLET))
    add(f'<rect x="{ex + 24}" y="{TOP + 118}" width="{ew - 48}" height="58" rx="12" '
        f'fill="#FFF7ED" stroke="#FDBA74"/>')
    add(glyph("hourglass", ex + 38, TOP + 135, 22, LOOP))
    add(t(ex + 72, TOP + 142, "payment history →", 15, MUTED))
    add(t(ex + 72, TOP + 163, "learned delays", 16, INK, 650))
    add(flow([(ex + 49, TOP + 118), (ex + 49, cash_y + 44)], LOOP))
    add(item(ex + 24, risk_y, "calculator", "Risk engine", "domino effects · stress", VIOLET))

    ai0 = TOP + 288
    add(card(ex, ai0, ew, 276))
    add(t(ex + 24, ai0 + 38, "AI providers", 21, INK, 650))
    apify_y, creao_y, claude_y = ai0 + 54, ai0 + 124, ai0 + 208
    add(item(ex + 24, creao_y, "", "CREAO", "primary agents", VIOLET, logo="creao"))
    add(item(ex + 24, claude_y, "", "Claude", "fallback · Ask Domino", VIOLET, logo="claude"))
    add(flow([(ex + 44, creao_y + 42), (ex + 44, claude_y - 2)], AIC, dashed=True))
    add(t(ex + 58, creao_y + 70, "fallback", 15, AIC, 600))
    add(item(ex + 24, apify_y, "", "Apify", "web search tool", VIOLET, logo="apify"))

    # 4. App: the Worker first, where decisions are made.
    ax, aw = COLS["app"]
    add(column_head("app", "App", GREEN, ("nextdotjs", "react", "tailwindcss")))
    add(card(ax, TOP, aw, BOTTOM - TOP))
    pages = [("bot-message-square", "Worker", "fixes · flags · learned"),
             ("layout-dashboard", "Dashboard", "cash at a glance"),
             ("users", "Customers", "payment behavior + risk"),
             ("brain-circuit", "Brain map", "agents at work"),
             ("messages-square", "Timeline", "scenarios · Ask Domino"),
             ("flask-conical", "Try it", "judge sandbox · 2U")]
    for i, (tile, title, note) in enumerate(pages):
        add(item(ax + 24, TOP + 28 + i * 104, tile, title, note, GREEN))

    # 5. People.
    px, pw = COLS["people"]
    add(column_head("people", "People", SLATE))
    add(card(px, TOP, pw, 196))
    add(icon_tile("user-round", px + pw / 2 - 30, TOP + 24, SLATE, 60))
    add(t(px + pw / 2, TOP + 118, "Finance lead", 20, INK, 600, "middle"))
    add(t(px + pw / 2, TOP + 142, "or judge,", 17, MUTED, 400, "middle"))
    add(t(px + pw / 2, TOP + 166, "in a browser", 17, MUTED, 400, "middle"))

    # ---- flows between containers ----
    sx, sw = COLS["sources"]
    # Vendors -> webhooks trigger; triggers wake ingestion.
    add(flow([(sx + 170, bus_y), (bus_x, bus_y), (bus_x, TOP + 38), (x, TOP + 38)], DATA,
             "new entries", ((sx + sw + x) / 2, TOP + 20)))
    add(flow([(x + 44, TOP + 98), (x + 44, rows["ingest"] - 2)], DATA, "wake",
             (x + 82, TOP + 108)))
    # Nessie -> Ingestion; CRS -> Audit swarm.
    add(flow([(sx + 170, TOP + 372), (sx + sw + 38, TOP + 372), (sx + sw + 38, rows["ingest"] + 20),
              (x + 22, rows["ingest"] + 20)], DATA, "bank data", (sx + sw + 38, TOP + 246)))
    add(flow([(sx + 140, TOP + 442), (sx + sw + 64, TOP + 442), (sx + sw + 64, rows["audit"] + 20),
              (x + 22, rows["audit"] + 20)], DATA, "identity", (sx + sw + 64, TOP + 410)))
    # Agents <-> Engine.
    gx = x + w                           # right edge of the Convex column
    add(flow([(x + 202, rows["forecast"] + 8), (gx + 36, rows["forecast"] + 8),
              (gx + 36, cash_y + 20), (ex - 2, cash_y + 20)], DATA, both=True))
    add(flow([(ex - 2, risk_y + 20), (gx + 62, risk_y + 20), (gx + 62, rows["forecast"] + 26),
              (x + 212, rows["forecast"] + 26)], DATA))
    add(pill(x + 300, rows["forecast"] - 22, "scenarios ⇄ forecasts\ndomino effects", DATA))
    # Forecasting -> Apify (the research agent runs in the forecasting swarm);
    # Agents <-> CREAO (plan, explain).
    add(flow([(x + 212, rows["forecast"] + 44), (ex - 2, rows["forecast"] + 44)], AIC,
             "research", (x + 300, rows["forecast"] + 62)))
    add(flow([(x + 176, rows["advisors"] + 10), (gx + 76, rows["advisors"] + 10),
              (gx + 76, creao_y + 20), (ex - 2, creao_y + 20)], AIC, "plan · explain",
             (x + 300, rows["advisors"] + 28), both=True))
    # Agents -> Mutations; Live queries -> App pages.
    add(flow([(x + 120, ay0 + 354), (x + 120, sy0 + 46), (x + 45, sy0 + 46),
              (x + 45, sy0 + 72)], RES, "results", (x + 120, ay0 + 364)))
    add(flow([(x + 314, sy0 + 95), (ax - 2, sy0 + 95)], RES, "live updates",
             ((ex + ex + ew) / 2, sy0 + 95)))
    # People -> Worker decisions -> learned rules (over the top) -> next run.
    add(flow([(px - 2, TOP + 52), (ax + aw + 2, TOP + 52)], LOOP, "decide",
             ((ax + aw + px) / 2, TOP + 30)))
    top_y = TOP - 62
    add(flow([(ax + aw - 40, TOP), (ax + aw - 40, top_y), (lr[0] + 100, top_y),
              (lr[0] + 100, lr[1] - 2)], LOOP, "decisions become rules",
             ((ax + aw - 40 + lr[0] + 100) / 2, top_y)))

    # Tech stack strip: fixed slots so it ends exactly at the right margin.
    add(f'<line x1="64" y1="952" x2="{W - 64}" y2="952" stroke="{LINE}"/>')
    add(t(64, 1012, "BUILT WITH", 15, SOFT, 700, spacing=1.6))
    stack = [("nextdotjs", "Next.js 16"), ("react", "React 19"), ("tailwindcss", "Tailwind"),
             ("typescript", "TypeScript"), ("convex", "Convex"), ("vercel", "Vercel"),
             ("pnpm", "pnpm"), ("turborepo", "Turborepo"), ("vitest", "Vitest"),
             ("biome", "Biome"), ("claude", "Claude"), ("creao", "CREAO"), ("apify", "Apify"),
             ("capitalone", "Nessie"), ("crs", "CRS")]
    widths = [31 + len(label) * 9.0 for _, label in stack]
    gap = (W - 64 - 196 - sum(widths)) / (len(stack) - 1)
    sx0 = 196
    for (name, label), width in zip(stack, widths):
        add(mark(name, sx0, 991, 24))
        add(t(sx0 + 31, 1010, label, 15, MUTED, 500))
        sx0 += width + gap

    markers = "".join(
        f'<marker id="e-{key}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" '
        f'markerHeight="5.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>'
        f'<marker id="s-{key}" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="5.5" '
        f'markerHeight="5.5" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{color}"/></marker>'
        for color, key in FLOWS.items())
    defs = (f'<defs><filter id="soft" x="-5%" y="-5%" width="110%" height="115%">'
            f'<feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#1C1917" '
            f'flood-opacity="0.05"/></filter>{markers}</defs>')
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
