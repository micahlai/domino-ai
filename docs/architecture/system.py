#!/usr/bin/env python3
"""Domino system architecture, one slide (16:9), drawn with mingrammer/diagrams.

Run:  python system.py            -> domino-system.png + domino-system.svg next to this file
Needs Graphviz on PATH and `pip install -r requirements.txt`. Reads no credentials or data.
Icons are the committed tiles in icons/ (rebuild with make_icons.py; sources listed there).

Layout: containers, nodes and edges are diagrams objects, but nothing is auto-placed. Every
container (BOXES), icon (ICON_AT) and edge route (routes(), right-angle paths with rounded
corners) is set by hand on a 2000 x 1125 pt grid and rendered with `neato -n2`, so spacing stays
even and lines do not cut through boxes. A first pass measures each node's label size so the
icons, not the label blocks, sit exactly on the grid.

Facts were checked against the code on field/main 7d6787e (2026-10-25):
  - pages: apps/web/components/AppShell.tsx nav (Dashboard, Worker, Brain map, Connected tools,
    Timeline, Try it); 2U backtest at /case/2u
  - triggers: convex/fieldClock.ts (scheduled ticks advance the simulated world, post signed
    webhooks, ingest), convex/http.ts (signed POST /webhooks/<vendor>/<company>)
  - agents: fieldAudit.ts (7 engine checkers + identity and fraud check, fieldCrs.ts and
    connectors/crs.ts), fieldAnalyst.ts (forecasters + research), fieldAdvisor.ts,
    fieldCoordinator.ts, fieldAi.ts (CREAO first, Claude fallback), fieldApify.ts
  - vendors: apps/mocks (synthetic Stripe/HubSpot/Ramp/QuickBooks/Gusto shapes), served
    in-process (convex/connectors/inProcess.ts); bank via Capital One Nessie sandbox
  - schema: convex/schemas/{field,timeline,legacy}.schema.ts
  - learning: field.decide stores the person's confirm / dismiss in `approvals`. The forecast
    reads the company model's per-customer payment delays (engine recurring-revenue.ts,
    schedule.ts). Scoped, versioned, revocable learned rules (engine learned-rules.ts) are built
    and tested in the engine, but no Convex function turns decisions into rules or applies them
    yet, so "becomes a rule" and "applied on the next run" are drawn dashed.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import tempfile
from html import escape
from pathlib import Path

from diagrams import Cluster, Diagram, Edge, Node

HERE = Path(__file__).resolve().parent
ICONS = HERE / "icons"

W, H = 2000, 1125     # canvas in points, 16:9
DPI = 138             # 2000 pt at 138 dpi = 3833 px wide; downscales cleanly to 1920 x 1080

INK = "#0F172A"
MUTED = "#475569"
DATA_IN = "#2563EB"   # data coming in
AI = "#7C3AED"        # model and agent calls
RESULT = "#16A34A"    # results flowing to the UI
CONTROL = "#64748B"   # people and triggers starting work
LEARN = "#D97706"     # the learning loop
FONT = "Helvetica Neue"
TITLE_PT, NOTE_PT, EDGE_PT, BOX_PT, SUB_PT = 21, 15.5, 16, 22, 15.5
ICON_PT = 58          # icon tile size
ROW_ICON_PT = 40      # icon size in compact row nodes (icon left, text right)
HALF = ICON_PT / 2 + 2

# Containers, top-down (x1, y1, x2, y2).
BOXES = {
    "sources": (30, 160, 380, 735),
    "real": (50, 525, 360, 720),
    "engine": (640, 160, 1060, 350),
    "ai": (1090, 160, 1510, 350),
    "convex": (415, 372, 1510, 1095),
    "triggers": (435, 427, 645, 580),
    "agents": (670, 427, 1200, 855),
    "storage": (1225, 427, 1490, 855),
    "learning": (670, 875, 1490, 1075),
    "frontend": (1530, 160, 1790, 1095),
    "users": (1815, 505, 1975, 720),
}
# Icon centers (column nodes) or node centers (row and panel nodes), top-down.
ICON_AT = {
    "header": (1000, 78), "vendors": (205, 330), "stack": (205, 925),
    "nessie": (205, 600), "crs": (205, 670),
    "risk": (752, 245), "cash": (935, 245),
    "apify": (1170, 245), "creao": (1300, 245), "claude": (1430, 245),
    "http": (540, 487), "clock": (540, 543),
    "ingest": (752, 505), "analyst": (935, 505), "advisors": (1115, 505), "audit": (935, 755),
    "mutations": (1357, 505), "tables": (1357, 640), "queries": (1357, 775),
    "delays": (1185, 918), "rules": (935, 985), "decisions": (1357, 985),
    "brain": (1660, 270), "tryit": (1660, 440), "timeline": (1660, 610),
    "dashboard": (1660, 775), "worker": (1660, 985),
    "user": (1895, 610),
}
ROW_NODES = {"nessie", "crs", "http", "clock", "delays", "header", "vendors", "stack"}


# ---------- labels ----------

def img(name: str, size: float) -> str:
    return (f'<TD FIXEDSIZE="TRUE" WIDTH="{size}" HEIGHT="{size}">'
            f'<IMG SRC="{ICONS / (name + ".png")}" SCALE="TRUE"/></TD>')


def text(title: str, note: str = "", size: float = TITLE_PT) -> str:
    out = f'<FONT POINT-SIZE="{size}" FACE="{FONT} Medium" COLOR="{INK}">{escape(title)}</FONT>'
    if note:
        lines = "<BR/>".join(escape(line) for line in note.split("\n"))
        out += f'<BR/><FONT POINT-SIZE="{NOTE_PT}" FACE="{FONT}" COLOR="{MUTED}">{lines}</FONT>'
    return out


def column_label(tile: str, title: str, note: str) -> str:
    return (f'<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="1" CELLPADDING="1">'
            f'<TR>{img(tile, ICON_PT)}</TR><TR><TD>{text(title, note)}</TD></TR></TABLE>')


def row_label(tile: str, title: str, note: str) -> str:
    return (f'<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="4" CELLPADDING="0"><TR>'
            f'{img(tile, ROW_ICON_PT)}<TD ALIGN="LEFT" BALIGN="LEFT">'
            f'{text(title, note, TITLE_PT - 2)}</TD></TR></TABLE>')


def grid_label(logos: list[tuple[str, str]], cols: int, size: float, title: str, note: str,
               border: str, fill: str) -> str:
    def cell(tile: str, caption: str) -> str:
        return (f'<TD><TABLE BORDER="0" CELLSPACING="0" CELLPADDING="1"><TR>{img(tile, size)}'
                f'</TR><TR><TD><FONT POINT-SIZE="{NOTE_PT}" FACE="{FONT} Medium" COLOR="{INK}">'
                f'{escape(caption)}</FONT></TD></TR></TABLE></TD>')

    rows = [logos[i:i + cols] for i in range(0, len(logos), cols)]
    body = "".join("<TR>" + "".join(cell(*n) for n in row)
                   + "<TD></TD>" * (cols - len(row)) + "</TR>" for row in rows)
    head = (f'<TR><TD COLSPAN="{cols}" ALIGN="LEFT" BALIGN="LEFT">'
            f'{text(title, note, BOX_PT - 2)}</TD></TR>')
    return (f'<TABLE BORDER="2" COLOR="{border}" BGCOLOR="{fill}" STYLE="ROUNDED" '
            f'CELLBORDER="0" CELLSPACING="9" CELLPADDING="3">{head}{body}</TABLE>')


def header_label() -> str:
    item = '<FONT POINT-SIZE="17" FACE="{f} Bold" COLOR="{c}">{line} {t}</FONT>'
    gap = '<FONT POINT-SIZE="17">      </FONT>'
    items = gap.join(item.format(f=FONT, c=c, t=t, line=line) for c, t, line in [
        (DATA_IN, "data in", "━━"), (AI, "AI calls", "━━"), (RESULT, "results to the UI", "━━"),
        (CONTROL, "people and triggers", "━━"), (LEARN, "learning loop", "━━"),
        (MUTED, "dashed: built in the engine, not wired into the live app yet", "╍╍")])
    return (f'<TABLE BORDER="0" CELLSPACING="4"><TR><TD><FONT POINT-SIZE="40" FACE="{FONT} Bold" '
            f'COLOR="{INK}">Domino system architecture</FONT></TD></TR><TR><TD>'
            f'<FONT POINT-SIZE="19" FACE="{FONT}" COLOR="{MUTED}">From simulated books to a live '
            f'13-week cash forecast. Domino reads only; it never moves money.</FONT></TD></TR>'
            f'<TR><TD>{items}</TD></TR></TABLE>')


def box(key: str, title: str, subtitle: str, fill: str, line: str,
        logos: tuple[str, ...] = (), title_x: float | None = None) -> dict:
    """Container pinned to BOXES[key]: brand logos, bold title and muted subtitle on one line.
    title_x centers a short title there instead (to keep it clear of lines entering the box)."""
    x1, y1, x2, y2 = BOXES[key]
    inner = x2 - x1 - 28 if title_x is None else 90
    marks = "".join(img(name, BOX_PT + 6) for name in logos)
    words = f'<FONT POINT-SIZE="{BOX_PT}" FACE="{FONT} Bold" COLOR="{INK}">{escape(title)}</FONT>'
    if subtitle:
        words += (f'<FONT POINT-SIZE="{SUB_PT}" FACE="{FONT}" COLOR="{MUTED}">'
                  f'   {escape(subtitle)}</FONT>')
    label = (f'<<TABLE BORDER="0" CELLSPACING="4" CELLPADDING="0" FIXEDSIZE="TRUE" '
             f'WIDTH="{inner}" HEIGHT="32"><TR>{marks}'
             f'<TD ALIGN="LEFT" WIDTH="{inner}">{words}</TD></TR></TABLE>>')
    return {"label": label, "bb": f"{x1},{H - y2},{x2},{H - y1}",
            "lp": f"{title_x or (x1 + x2) / 2},{H - y1 - 24}", "pencolor": line, "penwidth": "2",
            "style": "rounded,filled", "fillcolor": fill, "bgcolor": fill}


# ---------- geometry ----------

class Layout:
    """Node centers from ICON_AT plus measured label sizes; anchors on each icon's sides."""

    def __init__(self, sizes: dict[str, tuple[float, float]]):
        self.sizes = sizes

    def size(self, name: str) -> tuple[float, float]:
        return self.sizes.get(name, (0.0, 0.0))

    def center(self, name: str) -> tuple[float, float]:
        x, y = ICON_AT[name]
        if name in ROW_NODES:
            return x, y
        return x, y - HALF + self.size(name)[1] / 2   # icon cell sits at the top of the node

    def pos(self, name: str) -> str:
        x, y = self.center(name)
        return f"{x:.1f},{H - y:.1f}"

    # Anchors, top-down coordinates.
    def left(self, name: str, dy: float = 0) -> tuple[float, float]:
        x, y = ICON_AT[name]
        half = self.size(name)[0] / 2 + 2 if name in ROW_NODES else HALF
        return x - half, y + dy

    def right(self, name: str, dy: float = 0) -> tuple[float, float]:
        x, y = ICON_AT[name]
        half = self.size(name)[0] / 2 + 2 if name in ROW_NODES else HALF
        return x + half, y + dy

    def top(self, name: str, dx: float = 0) -> tuple[float, float]:
        x, y = ICON_AT[name]
        if name in ROW_NODES:
            return x + dx, y - self.size(name)[1] / 2 - 2
        return x + dx, y - HALF

    def bottom(self, name: str, dx: float = 0) -> tuple[float, float]:
        cx, cy = self.center(name)
        return cx + dx, cy + self.size(name)[1] / 2 + 2


def _toward(a: list[float], b: list[float], d: float) -> list[float]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = max((dx * dx + dy * dy) ** 0.5, 1e-9)
    return [a[0] + dx / n * d, a[1] + dy / n * d]


def _line(a: list[float], b: list[float]) -> list[list[float]]:
    """Cubic Bezier control points (without the start) for a straight segment."""
    return [[a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
            [a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3], b]


def spline(points: list[tuple[float, float]], both: bool = False, radius: float = 14) -> str:
    """Graphviz edge pos for a right-angle path with rounded corners (top-down input)."""
    arrow = 9.0
    pts = [list(p) for p in points]
    tip, tail = list(pts[-1]), list(pts[0])
    pts[-1] = _toward(pts[-1], pts[-2], arrow)
    if both:
        pts[0] = _toward(pts[0], pts[1], arrow)
    out, cur = [pts[0]], pts[0]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        r = min(radius, abs(b[0] - a[0]) + abs(b[1] - a[1]), abs(c[0] - b[0]) + abs(c[1] - b[1]))
        p_in, p_out = _toward(b, a, r), _toward(b, c, r)
        out += _line(cur, p_in) + [_toward(p_in, b, r * 0.55), _toward(p_out, b, r * 0.55), p_out]
        cur = p_out
    out += _line(cur, pts[-1])
    head = f"e,{tip[0]:.1f},{H - tip[1]:.1f} "
    if both:
        head = f"s,{tail[0]:.1f},{H - tail[1]:.1f} " + head
    return head + " ".join(f"{x:.1f},{H - y:.1f}" for x, y in out)


def route(points, label: str, at: tuple[float, float] | None, color: str,
          dashed: bool = False, both: bool = False) -> Edge:
    attrs = {"pos": spline(points, both), "color": color, "fontcolor": color,
             "fontsize": str(EDGE_PT), "fontname": f"{FONT} Medium", "penwidth": "2.6",
             "arrowsize": "0.9"}
    if both:
        attrs["dir"] = "both"
    if label:
        attrs["label"] = label
        attrs["lp"] = f"{at[0]:.1f},{H - at[1]:.1f}"
    return Edge(style="dashed" if dashed else "", **attrs)


def routes(g: Layout) -> list[tuple[str, str, Edge]]:
    """Every edge as (from, to, Edge). Paths turn only at right angles and avoid nodes."""
    L, R, T, B = g.left, g.right, g.top, g.bottom
    vx = R("vendors")[0]
    ai_bottom = BOXES["ai"][3] + 1
    return [
        # Data in.
        ("vendors", "http", route([(vx, 400), (398, 400), (398, 487), L("http")],
                                  "", None, DATA_IN)),
        ("vendors", "ingest", route([(vx, 361), (752, 361), T("ingest")],
                                    "books snapshot", (525, 347), DATA_IN)),
        ("http", "ingest", route([R("http"), L("ingest", -18)], "", None, CONTROL)),
        ("clock", "ingest", route([R("clock"), (700, 543), (700, 523), L("ingest", 18)],
                                  "tick", (668, 529), CONTROL)),
        ("nessie", "ingest", route([R("nessie"), (728, 600), B("ingest", -24)],
                                   "bank transactions", (540, 586), DATA_IN)),
        ("crs", "audit", route([R("crs"), (745, 670), (745, 778), L("audit", 23)],
                               "identity + fraud result", (540, 656), DATA_IN)),
        ("ingest", "analyst", route([R("ingest"), L("analyst")], "snapshot", (843, 491), DATA_IN)),
        ("ingest", "audit", route([B("ingest", 18), (770, 742), L("audit", -13)], "snapshot",
                                  (838, 728), DATA_IN)),
        ("analyst", "advisors", route([R("analyst"), L("advisors")],
                                      "cash below limit", (1025, 491), DATA_IN)),
        # Money math is engine code; AI only explains, plans and searches.
        ("analyst", "cash", route([T("analyst"), B("cash")], "scenarios ⇄ forecasts",
                                  (1012, 398), DATA_IN, both=True)),
        ("advisors", "creao", route([T("advisors"), (1115, ai_bottom)],
                                    "explain flags · plan\npick a fix · research",
                                    (1210, 399), AI)),
        ("creao", "claude", route([R("creao"), L("claude")], "fallback", (1365, 230), AI,
                                  dashed=True)),
        # Results to the UI.
        ("advisors", "mutations", route([R("advisors"), L("mutations")],
                                        "forecasts · suggestions", (1236, 491), RESULT)),
        ("audit", "mutations", route([R("audit", -8), (1255, 747), (1255, 521),
                                      L("mutations", 16)], "flags", (1100, 733), RESULT)),
        ("mutations", "tables", route([B("mutations"), T("tables")], "", None, RESULT)),
        ("tables", "queries", route([B("tables"), T("queries")], "", None, RESULT)),
        ("queries", "dashboard", route([R("queries"), L("dashboard")], "live updates",
                                       (1508, 761), RESULT)),
        ("user", "timeline", route([L("user"), R("timeline")], "review · ask", (1777, 596),
                                   CONTROL)),
        # Learning loop.
        ("worker", "decisions", route([L("worker"), R("decisions")], "confirm · dismiss",
                                      (1508, 971), LEARN)),
        ("decisions", "rules", route([L("decisions"), R("rules")], "becomes a rule",
                                     (1150, 971), LEARN, dashed=True)),
        ("rules", "audit", route([T("rules"), B("audit")], "applied on the next run",
                                 (1030, 860), LEARN, dashed=True)),
        ("delays", "analyst", route([T("delays"), (1185, 610), (958, 610), B("analyst", 23)],
                                    "payment delays", (1075, 596), LEARN)),
    ]


# ---------- graph ----------

def build(out: Path, formats: list[str], sizes: dict[str, tuple[float, float]] | None) -> str:
    """Builds and renders the diagram. sizes=None is the measuring pass: nodes only, returns
    the Graphviz source instead of rendering."""
    g = Layout(sizes or {})
    graph_attr = {"bgcolor": "#FFFFFF", "splines": "true", "dpi": str(DPI), "pad": "0",
                  "outputorder": "edgesfirst", "label": ""}
    nodes: dict[str, Node] = {}
    source: dict[str, str] = {}

    def put(name: str, label: str) -> None:
        nodes[name] = Node(f"<{label}>", nodeid=name, shape="plain", fixedsize="false",
                           style="", pos=g.pos(name))

    def col(name: str, tile: str, title: str, note: str = "") -> None:
        put(name, column_label(tile, title, note))

    def row(name: str, tile: str, title: str, note: str) -> None:
        put(name, row_label(tile, title, note))

    with Diagram("", filename=str(out), show=False, outformat=formats,
                 graph_attr=graph_attr) as diagram:
        put("header", header_label())
        put("stack", grid_label([
            ("nextjs", "Next.js 16"), ("react", "React 19"), ("tailwind", "Tailwind"),
            ("convex", "Convex"), ("typescript", "TypeScript"), ("pnpm", "pnpm"),
            ("turborepo", "Turborepo"), ("vitest", "Vitest"), ("biome", "Biome"),
            ("vercel", "Vercel"), ("anthropic", "Claude"), ("creao", "CREAO"),
            ("apify", "Apify"), ("capitalone", "Nessie"), ("crs", "CRS"),
        ], cols=5, size=36, title="Tech stack",
            note="pnpm monorepo · apps/web · apps/mocks · packages/*",
            border="#E2E8F0", fill="#FFFFFF"))

        with Cluster("sources", graph_attr=box("sources", "Data sources", "", "#F8FAFC", "#CBD5E1")):
            put("vendors", grid_label([
                ("stripe", "Stripe"), ("ramp", "Ramp"), ("quickbooks", "QuickBooks"),
                ("gusto", "Gusto"), ("hubspot", "HubSpot")], cols=3, size=46,
                title="Mock vendor APIs", note="simulator-generated books",
                border="#93C5FD", fill="#EFF6FF"))
            with Cluster("real", graph_attr=box("real", "Real APIs", "sandboxes", "#FFFFFF",
                                                "#CBD5E1")):
                row("nessie", "capitalone", "Capital One Nessie", "bank transactions")
                row("crs", "crs", "CRS", "identity + fraud check")

        with Cluster("engine", graph_attr=box("engine", "Engine", "pure TypeScript, no AI",
                                              "#EEF2FF", "#A5B4FC", logos=("typescript",))):
            col("risk", "engine", "Risk engine", "audit checks · dominoes\nstress tests · score-fix")
            col("cash", "engine", "Cash engine", "13-week forecast\ncash flow · recurring revenue")

        with Cluster("ai", graph_attr=box("ai", "AI providers", "real services", "#FAF5FF",
                                          "#C4B5FD")):
            col("apify", "apify", "Apify", "search tool")
            col("creao", "creao", "CREAO", "primary")
            col("claude", "claude", "Claude", "fallback\nAsk Domino")

        with Cluster("convex", graph_attr=box("convex", "Convex backend", "", "#FFF7ED", "#FDBA74",
                                              logos=("convex",))):
            with Cluster("triggers", graph_attr=box("triggers", "Triggers", "", "#FFFFFF",
                                                    "#FDBA74")):
                row("http", "http", "HTTP webhooks", "signed vendor events")
                row("clock", "scheduler", "Scheduled", "sim clock ticks")
            with Cluster("agents", graph_attr=box("agents", "Agents", "", "#F0FDFA", "#5EEAD4",
                                                  title_x=822)):
                col("ingest", "ingest", "Ingestion")
                col("analyst", "forecast", "Forecasting", "swarm: stress scenarios")
                col("advisors", "advisor", "Advisors", "compare fixes")
                col("audit", "audit", "Audit swarm", "7 engine checks + CRS")
            with Cluster("storage", graph_attr=box("storage", "Storage + realtime", "", "#FFFFFF",
                                                   "#FDBA74")):
                col("mutations", "mutations", "Mutations")
                col("tables", "tables", "Tables", "Field · Timeline · Legacy")
                col("queries", "queries", "Reactive queries", "useQuery")
            with Cluster("learning", graph_attr=box("learning", "Learning loop",
                                                    "decisions teach the agents",
                                                    "#FFFBEB", "#FCD34D")):
                row("delays", "delays", "Payment delays", "per customer · used by the forecast")
                col("rules", "rules", "Learned rules", "scoped · versioned · revocable")
                col("decisions", "decisions", "Decisions", "confirm · dismiss")

        with Cluster("frontend", graph_attr=box("frontend", "Frontend", "", "#F8FAFC", "#94A3B8",
                                                logos=("nextjs", "react", "tailwind"))):
            col("brain", "brainmap", "Brain map", "+ Connected tools")
            col("tryit", "tryit", "Try it", "+ 2U backtest")
            col("timeline", "timeline", "Timeline", "+ Ask Domino")
            col("dashboard", "dashboard", "Dashboard")
            col("worker", "worker", "Worker", "suggestions · risks · flags")

        with Cluster("users", graph_attr=box("users", "Users", "", "#F8FAFC", "#CBD5E1")):
            col("user", "user", "Finance lead", "or Judge, in a browser")

        # Invisible corner points fix the canvas to exactly W x H.
        Node("", nodeid="corner_lo", shape="point", style="invis", width="0", height="0",
             pos="0,0")
        Node("", nodeid="corner_hi", shape="point", style="invis", width="0", height="0",
             pos=f"{W},{H}")

        if sizes is not None:
            for a, b, edge in routes(g):
                nodes[a] >> edge >> nodes[b]

        # Render with every position pinned (neato -n2) instead of dot's automatic layout.
        diagram.dot.engine = "neato"

        def capture() -> None:
            source["text"] = diagram.dot.source
            Path(diagram.filename).write_text("")   # diagrams deletes this file on exit

        def render() -> None:
            for fmt in formats:
                diagram.dot.render(format=fmt, quiet=True, neato_no_op=2)

        diagram.render = capture if sizes is None else render
    return source.get("text", "")


def measure() -> dict[str, tuple[float, float]]:
    """Label size in points of every node, from a nodes-only Graphviz pass."""
    with tempfile.TemporaryDirectory() as tmp:
        src = build(Path(tmp) / "measure", ["png"], None)
    laid = json.loads(subprocess.run(["neato", "-n2", "-Tjson"], input=src, text=True,
                                     capture_output=True, check=True).stdout)
    return {o["name"]: (float(o["width"]) * 72, float(o["height"]) * 72)
            for o in laid.get("objects", []) if "width" in o}


def inline_svg_images(svg: Path) -> None:
    """Embed the icon PNGs so the SVG carries no local file paths and opens anywhere."""
    def embed(match: re.Match) -> str:
        data = base64.b64encode(Path(match.group(1)).read_bytes()).decode()
        return f'xlink:href="data:image/png;base64,{data}"'

    svg.write_text(re.sub(r'xlink:href="([^"]+\.png)"', embed, svg.read_text()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=HERE / "domino-system",
                        help="output path without extension")
    parser.add_argument("--formats", default="png,svg")
    args = parser.parse_args()
    formats = args.formats.split(",")
    build(args.out, formats, measure())
    if "svg" in formats:
        inline_svg_images(args.out.with_suffix(".svg"))
    for fmt in formats:
        print(args.out.with_suffix(f".{fmt}"))


if __name__ == "__main__":
    main()
