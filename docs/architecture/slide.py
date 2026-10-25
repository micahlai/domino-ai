#!/usr/bin/env python3
"""Domino system architecture slide (v6), hand-laid at 1920 x 1080.

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
COLS = {"sources": (64, 240), "convex": (414, 500), "engine": (1034, 236),
        "app": (1380, 236), "people": (1726, 130)}
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
    out = f'<circle cx="{x + 5}" cy="{TOP - 28}" r="4.5" fill="{color}"/>'
    out += t(x + 18, TOP - 22, label.upper(), 15, color, 700, spacing=1.5)
    lx = x + 28 + len(label) * 11.6
    for name in logos:
        out += mark(name, lx, TOP - 38, 20)
        lx += 27
    return out


ICON = 34   # agent / page icon tile size


def item(x: float, y: float, tile: str, title: str, note: str, color: str,
         logo: str | None = None) -> str:
    """Icon (top-left at x, y) with a title and one muted line to its right."""
    out = mark(logo, x + 3, y + 3, ICON - 6) if logo else icon_tile(tile, x, y, color, ICON)
    out += t(x + ICON + 12, y + 14, title, 17, INK, 600)
    if note:
        out += t(x + ICON + 12, y + 32, note, 14, MUTED)
    return out


# Flow colors (legend): data in, AI calls, results to the UI, learning loop.
DATA, AIC, RES = "#2563EB", "#7C3AED", "#16A34A"
FLOWS = {DATA: "data", AIC: "ai", RES: "res", LOOP: "loop"}


def flow(points: list[tuple[float, float]], color: str, label: str = "",
         at: tuple[float, float] | None = None, both: bool = False, dashed: bool = False,
         r: float = 8) -> str:
    """A right-angle path with rounded corners and an arrowhead. A background-colored halo
    under each line keeps the rare crossing crisp. The label pill is placed beside the line."""
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
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    start = f' marker-start="url(#s-{key})"' if both else ""
    out = f'<path d="{d}" fill="none" stroke="{BG}" stroke-width="7" stroke-linejoin="round"/>'
    out += (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2" '
            f'stroke-linejoin="round"{dash}{start} marker-end="url(#e-{key})"/>')
    if label:
        out += pill(at[0], at[1], label, color)
    return out


def pill(cx: float, cy: float, label: str, color: str, anchor: str = "middle") -> str:
    """Edge label on a small background pill (cx is the pill's center)."""
    lines = label.split("\n")
    width = max(len(s) for s in lines) * 7.6 + 12
    height = 17 * len(lines) + 3
    out = (f'<rect x="{cx - width / 2:.1f}" y="{cy - height / 2:.1f}" width="{width:.1f}" '
           f'height="{height}" rx="7" fill="#FFFFFF" fill-opacity="0.94"/>')
    for i, line in enumerate(lines):
        y = cy - height / 2 + 14 + i * 17
        out += t(cx, y, line, 13.5, color, 600, "middle")
    return out


def legend(x: float, y: float) -> str:
    out = ""
    for color, label in [(DATA, "data in"), (AIC, "AI calls"), (RES, "results to the UI"),
                         (LOOP, "learning loop")]:
        out += (f'<line x1="{x}" y1="{y - 5}" x2="{x + 24}" y2="{y - 5}" stroke="{color}" '
                f'stroke-width="3" stroke-linecap="round"/>')
        out += t(x + 31, y, label, 15, MUTED, 500)
        x += 31 + len(label) * 7.6 + 26
    return out


def sub(x: float, y: float, w: float, h: float, title: str, fill: str = CARD,
        stroke: str = LINE, title_x: float | None = None, anchor: str = "start") -> str:
    out = card(x, y, w, h, fill, stroke)
    if title:
        tx = title_x if title_x is not None else x + 18
        out += t(tx, y + 27, title, 17, INK, 650, anchor)
    return out


# ---------- slide ----------

def slide() -> str:
    parts: list[str] = []
    add = parts.append

    # Title and legend.
    add(t(64, 80, "How Domino works", 40, INK, 700, spacing=-0.4))
    add(t(64, 114, "Books and bank data in, a 13-week cash forecast and suggested fixes out. "
                   "A person approves every action; Domino never moves money.", 19, MUTED))
    add(legend(1352, 78))

    sx, sw = COLS["sources"]
    cx, cw = COLS["convex"]
    ex, ew = COLS["engine"]
    ax, aw = COLS["app"]
    px, pw = COLS["people"]

    # ---- 1. Sources ----
    add(column_head("sources", "Sources", BLUE))
    add(sub(sx, TOP, sw, 236, "Mock vendor APIs"))
    add(t(sx + 18, TOP + 47, "simulator-generated books", 14, MUTED))
    vendors = [("stripe", "Stripe"), ("ramp", "Ramp"), ("quickbooks", "QuickBooks"),
               ("gusto", "Gusto"), ("hubspot", "HubSpot")]
    bus_x = sx + sw - 22
    for i, (name, label) in enumerate(vendors):
        vy = TOP + 66 + i * 32
        add(mark(name, sx + 18, vy, 22))
        add(t(sx + 48, vy + 16, label, 15, INK, 500))
        if i < len(vendors) - 1:
            add(f'<path d="M {sx + 150} {vy + 11} L {bus_x - 8} {vy + 11} Q {bus_x} {vy + 11} '
                f'{bus_x} {vy + 3}" fill="none" stroke="{DATA}" stroke-width="2"/>')
    bus_y = TOP + 66 + (len(vendors) - 1) * 32 + 11
    real_y = TOP + 262
    add(sub(sx, real_y, sw, 174, "Real sandboxes"))
    nessie_y, crs_y = real_y + 48, real_y + 108          # item tops
    add(item(sx + 18, nessie_y, "", "Capital One", "Nessie bank", BLUE, logo="capitalone"))
    add(item(sx + 18, crs_y, "", "CRS", "identity + fraud", BLUE, logo="crs"))

    # ---- 2. Convex backend ----
    add(column_head("convex", "Convex backend", RED, ("convex",)))
    # Triggers (top left).
    add(sub(cx, TOP, 250, 84, "Triggers"))
    add(icon_tile("webhook", cx + 18, TOP + 42, RED, 26))
    add(t(cx + 52, TOP + 60, "webhooks", 14, MUTED))
    add(icon_tile("alarm-clock", cx + 136, TOP + 42, RED, 26))
    add(t(cx + 170, TOP + 60, "sim clock", 14, MUTED))

    # Agents card.
    ag_top, ag_bot = TOP + 118, TOP + 536
    add(sub(cx, ag_top, cw, ag_bot - ag_top, "Agents", title_x=cx + cw - 18, anchor="end"))
    add(t(cx + cw - 18, ag_top + 46, "Convex actions", 13.5, SOFT, 400, "end"))
    ix = cx + 64                                  # agent icon column (left lanes sit before it)
    rows = {"ingest": ag_top + 34, "audit": ag_top + 118, "advisors": ag_top + 202,
            "forecast": ag_top + 286}
    cy_ = {k: v + ICON / 2 for k, v in rows.items()}   # icon centers
    add(item(ix, rows["ingest"], "file-input", "Ingestion", "maps every tool", RED))
    add(item(ix, rows["audit"], "shield-check", "Audit swarm", "7 checks + CRS", RED))
    add(item(ix, rows["advisors"], "lightbulb", "Advisors", "compare fixes", RED))
    add(item(ix, rows["forecast"], "trending-up", "Forecasting", "stress scenarios", RED))
    text_end = ix + ICON + 12 + 120               # right edge of the agent labels
    icx = ix + ICON / 2

    # Learned rules chip, bottom left of the agents card.
    lr_x, lr_y, lr_w, lr_h = cx + 18, ag_top + 352, 236, 50
    add(f'<rect x="{lr_x}" y="{lr_y}" width="{lr_w}" height="{lr_h}" rx="11" fill="#FFF7ED" '
        f'stroke="#FDBA74"/>')
    add(glyph("list-checks", lr_x + 12, lr_y + 14, 22, LOOP))
    add(t(lr_x + 44, lr_y + 22, "Learned rules", 15, INK, 650))
    add(t(lr_x + 44, lr_y + 39, "scoped · versioned · revocable", 12.5, MUTED))

    # Storage + realtime (bottom right of the Convex column).
    st_x, st_y = cx + 196, ag_bot + 24
    add(sub(st_x, st_y, cw - 196, BOTTOM - st_y, "Storage + realtime",
            title_x=cx + cw - 18, anchor="end"))
    store = [("square-pen", "Mutations"), ("table-2", "Tables"), ("radio", "Live queries")]
    tiles = []
    for i, (tile, label) in enumerate(store):
        tx = st_x + 22 + i * 102
        add(icon_tile(tile, tx, st_y + 40, RED, 30))
        add(t(tx + 15, st_y + 88, label, 13.5, MUTED, 500, "middle"))
        tiles.append(tx)
    tile_cy = st_y + 55

    # ---- 3. Engine + AI ----
    add(column_head("engine", "Engine + AI", VIOLET))
    ai_top = TOP
    add(sub(ex, ai_top, ew, 252, "AI providers"))
    creao_y, claude_y, apify_y = ai_top + 46, ai_top + 120, ai_top + 190   # item tops
    add(item(ex + 18, creao_y, "", "CREAO", "primary agents", VIOLET, logo="creao"))
    add(item(ex + 18, claude_y, "", "Claude", "fallback · Ask Domino", VIOLET, logo="claude"))
    add(item(ex + 18, apify_y, "", "Apify", "web search tool", VIOLET, logo="apify"))
    add(flow([(ex + 35, creao_y + ICON + 2), (ex + 35, claude_y - 2)], AIC, dashed=True))
    add(t(ex + 46, creao_y + 56, "fallback", 13, AIC, 600))

    en_top = ai_top + 276
    add(sub(ex, en_top, ew, 254, "Engine"))
    add(mark("typescript", ex + ew - 40, en_top + 10, 22))
    cash_y, risk_y = en_top + 46, en_top + 186                    # item tops
    add(item(ex + 18, cash_y, "calculator", "Cash engine", "13-week forecast", VIOLET))
    add(f'<rect x="{ex + 18}" y="{en_top + 100}" width="{ew - 36}" height="50" rx="11" '
        f'fill="#FFF7ED" stroke="#FDBA74"/>')
    add(glyph("hourglass", ex + 28, en_top + 114, 20, LOOP))
    add(t(ex + 56, en_top + 120, "payment history →", 13, MUTED))
    add(t(ex + 56, en_top + 138, "learned delays", 14, INK, 650))
    add(flow([(ex + 35, en_top + 100), (ex + 35, cash_y + ICON + 3)], LOOP))
    add(item(ex + 18, risk_y, "calculator", "Risk engine", "domino effects · stress", VIOLET))

    # ---- 4. App (Worker last, next to the person) ----
    add(column_head("app", "App", GREEN, ("nextdotjs", "react", "tailwindcss")))
    add(card(ax, TOP, aw, BOTTOM - TOP))
    pages = [("layout-dashboard", "Dashboard", "cash at a glance"),
             ("users", "Customers", "payment behavior + risk"),
             ("brain-circuit", "Brain map", "agents at work"),
             ("messages-square", "Timeline", "scenarios · Ask Domino"),
             ("flask-conical", "Try it", "judge sandbox · 2U"),
             ("bot-message-square", "Worker", "fixes · flags · learned")]
    page_y = {}
    for i, (tile, title, note) in enumerate(pages):
        py = TOP + 30 + i * 104
        page_y[title] = py
        add(item(ax + 20, py, tile, title, note, GREEN))

    # ---- 5. People ----
    add(column_head("people", "People", SLATE))
    pc_y = page_y["Worker"] - 70
    add(card(px, pc_y, pw, 178))
    add(icon_tile("user-round", px + pw / 2 - 24, pc_y + 22, SLATE, 48))
    add(t(px + pw / 2, pc_y + 100, "Finance lead", 17, INK, 600, "middle"))
    add(t(px + pw / 2, pc_y + 121, "or judge,", 14, MUTED, 400, "middle"))
    add(t(px + pw / 2, pc_y + 140, "in a browser", 14, MUTED, 400, "middle"))

    # ================= flows =================
    gap_l = sx + sw            # sources right edge
    # Vendors -> webhooks.
    add(flow([(sx + 150, bus_y), (bus_x, bus_y), (bus_x, TOP + 55), (cx + 16, TOP + 55)],
             DATA, "new entries", ((gap_l + cx) / 2, TOP + 38)))
    # Triggers wake ingestion: webhook and clock tick, separate ports on the icon top.
    wk, ck = cx + 31, cx + 149
    add(flow([(wk, TOP + 70), (wk, TOP + 100), (icx - 7, TOP + 100), (icx - 7, rows["ingest"] - 2)],
             DATA, "wake", (wk + 38, TOP + 88)))
    add(flow([(ck, TOP + 70), (ck, TOP + 108), (icx + 7, TOP + 108), (icx + 7, rows["ingest"] - 2)],
             DATA, "tick", (ck + 26, TOP + 92)))
    # Nessie -> Ingestion, CRS -> Audit swarm (two lanes in the gap, no crossing).
    lane1, lane2 = gap_l + 30, gap_l + 60
    add(flow([(sx + 172, nessie_y + 17), (lane1, nessie_y + 17), (lane1, cy_["ingest"] + 6),
              (ix - 2, cy_["ingest"] + 6)], DATA, "bank data", (sx + 204, nessie_y)))
    add(flow([(sx + 172, crs_y + 17), (lane2, crs_y + 17), (lane2, cy_["audit"] - 8),
              (ix - 2, cy_["audit"] - 8)], DATA, "identity", (sx + 204, crs_y)))
    # Agent pipeline: Ingestion -> Audit -> Forecasting -> Advisors.
    add(flow([(icx, rows["ingest"] + ICON + 2), (icx, rows["audit"] - 2)], DATA,
             "snapshot", (icx + 48, rows["ingest"] + 62)))
    skip_x = text_end + 26
    f_top = rows["forecast"] - 2
    add(flow([(text_end, cy_["audit"] - 6), (skip_x, cy_["audit"] - 6),
              (skip_x, f_top - 24), (text_end - 40, f_top - 24), (text_end - 40, f_top)], DATA,
             "checked books", (skip_x + 60, cy_["audit"] + 30)))
    add(flow([(icx, rows["forecast"] - 2), (icx, rows["advisors"] + ICON + 2)], DATA,
             "cash gaps", (icx + 50, rows["advisors"] + 62)))
    # Agents <-> AI: Audit and Advisors call CREAO; Forecasting's research uses Apify.
    l_audit, l_adv = cx + cw + 22, cx + cw + 40
    add(flow([(text_end, cy_["audit"] - 14), (l_audit, cy_["audit"] - 14),
              (l_audit, creao_y + 10), (ex - 2, creao_y + 10)], AIC, "explain flags",
             (text_end + 150, cy_["audit"] - 30)))
    add(flow([(text_end, cy_["advisors"] - 4), (l_adv, cy_["advisors"] - 4),
              (l_adv, creao_y + 24), (ex - 2, creao_y + 24)], AIC, "pick a fix",
             (text_end + 150, cy_["advisors"] - 20)))
    # Forecasting fans its three lines out to even 28-32 px lanes so each label has room.
    f0 = cy_["forecast"]
    te = text_end + 4
    l_res, l_scn, l_dom = cx + cw + 56, cx + cw + 76, cx + cw + 96
    lab_x = text_end + 150
    add(flow([(te, f0 - 10), (te + 14, f0 - 10), (te + 14, f0 - 26), (l_res, f0 - 26),
              (l_res, apify_y + 17), (ex - 2, apify_y + 17)], AIC, "research",
             (lab_x, f0 - 42)))
    add(flow([(te, f0 + 2), (l_scn, f0 + 2), (l_scn, cash_y + 17), (ex - 2, cash_y + 17)], DATA,
             "scenarios ⇄ forecasts", (lab_x, f0 - 12), both=True))
    add(flow([(ex - 2, risk_y + 17), (l_dom, risk_y + 17), (l_dom, f0 + 38), (te + 14, f0 + 38),
              (te + 14, f0 + 14), (te, f0 + 14)], DATA, "domino effects", (lab_x, f0 + 54)))
    # Agents -> Mutations -> Tables -> Live queries -> App.
    add(flow([(tiles[0] + 15, ag_bot), (tiles[0] + 15, st_y + 38)], RES, "results",
             (tiles[0] + 52, ag_bot + 12)))
    add(flow([(tiles[0] + 32, tile_cy), (tiles[1] - 2, tile_cy)], RES))
    add(flow([(tiles[1] + 32, tile_cy), (tiles[2] - 2, tile_cy)], RES))
    add(flow([(tiles[2] + 32, tile_cy), (ax - 2, tile_cy)], RES, "live updates",
             ((ex + ex + ew) / 2, tile_cy - 14)))
    # People -> Worker decisions -> learned rules -> next audit / advisor run.
    wy = page_y["Worker"] + 17
    add(flow([(px - 2, wy), (ax + aw + 2, wy)], LOOP, "decide", ((ax + aw + px) / 2, wy - 16)))
    chan = BOTTOM + 34
    add(flow([(ax + 37, page_y["Worker"] + ICON + 2), (ax + 37, BOTTOM - 4)], LOOP))
    add(flow([(ax + 37, BOTTOM - 4), (ax + 37, chan), (lr_x + 110, chan),
              (lr_x + 110, lr_y + lr_h + 2)], LOOP, "decisions become rules",
             ((ex + ew + ax) / 2, chan - 14)))
    add(flow([(lr_x + 14, lr_y), (lr_x + 14, cy_["audit"] + 8), (ix - 2, cy_["audit"] + 8)],
             LOOP))
    add(flow([(lr_x + 30, lr_y), (lr_x + 30, cy_["advisors"]), (ix - 2, cy_["advisors"])],
             LOOP, "next run", (lr_x + 30 + 36, lr_y - 14)))

    # Tech stack strip.
    add(f'<line x1="64" y1="958" x2="{W - 64}" y2="958" stroke="{LINE}"/>')
    add(t(64, 1016, "BUILT WITH", 14, SOFT, 700, spacing=1.5))
    stack = [("nextdotjs", "Next.js 16"), ("react", "React 19"), ("tailwindcss", "Tailwind"),
             ("typescript", "TypeScript"), ("convex", "Convex"), ("vercel", "Vercel"),
             ("pnpm", "pnpm"), ("turborepo", "Turborepo"), ("vitest", "Vitest"),
             ("biome", "Biome"), ("claude", "Claude"), ("creao", "CREAO"), ("apify", "Apify"),
             ("capitalone", "Nessie"), ("crs", "CRS")]
    widths = [29 + len(label) * 8.6 for _, label in stack]
    gap = (W - 64 - 186 - sum(widths)) / (len(stack) - 1)
    x0 = 186
    for (name, label), width in zip(stack, widths):
        add(mark(name, x0, 996, 22))
        add(t(x0 + 29, 1014, label, 14, MUTED, 500))
        x0 += width + gap

    markers = "".join(
        f'<marker id="e-{key}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>'
        f'<marker id="s-{key}" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{color}"/></marker>'
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
