#!/usr/bin/env python3
"""Domino system architecture, one slide (16:9), drawn with mingrammer/diagrams.

Run:  python system.py            -> domino-system.png + domino-system.svg next to this file
Needs Graphviz `dot` on PATH and `pip install -r requirements.txt`. Reads no credentials or data.
Icons are the committed tiles in icons/ (rebuild with make_icons.py). Convex has no official mark
in the icon sets used, so its parts use generic glyphs.

Facts were checked against the code on field/main (2026-10-25):
  - pages: apps/web/components/AppShell.tsx nav (Dashboard, Worker, Brain map, Connected tools,
    Timeline, Try it); 2U backtest at /case/2u
  - webhooks: apps/web/convex/http.ts (signed POST /webhooks/<vendor>/<company>)
  - clock: convex/fieldClock.ts (scheduled ticks advance the simulator, deliver webhooks, ingest)
  - agents: fieldAudit.ts, fieldAnalyst.ts, fieldAdvisor.ts, fieldCoordinator.ts, fieldAi.ts
    (CREAO first, Claude fallback), fieldApify.ts + fieldTools.ts, timeline/assistant/claude.ts
  - vendors: apps/mocks (synthetic Stripe/HubSpot/Ramp/QuickBooks/Gusto shapes), served
    in-process (convex/connectors/inProcess.ts); bank via Capital One Nessie sandbox
  - schema: convex/schemas/{field,timeline,legacy}.schema.ts
"""

import argparse
import base64
import re
import shutil
import subprocess
from html import escape
from pathlib import Path

from diagrams import Cluster, Diagram, Edge, Node

HERE = Path(__file__).resolve().parent
ICONS = HERE / "icons"

INK = "#0F172A"
MUTED = "#475569"
DATA_IN = "#2563EB"   # data coming in
AI = "#7C3AED"        # model and agent calls
RESULT = "#16A34A"    # results flowing to the UI
CONTROL = "#64748B"   # people and timers starting work
FONT = "Helvetica Neue"
ICON_PT = 90          # icon tile size in points


def icon(name: str, title: str, note: str = "", gap: int = 0) -> Node:
    """An icon tile with a bold title and an optional muted note under it (HTML label)."""
    img = ICONS / f"{name}.png"
    text = f'<FONT POINT-SIZE="31" FACE="{FONT} Medium" COLOR="{INK}">{escape(title)}</FONT>'
    if note:
        lines = "<BR/>".join(escape(line) for line in note.split("\n"))
        text += f'<BR/><FONT POINT-SIZE="25" FACE="{FONT}" COLOR="{MUTED}">{lines}</FONT>'
    label = (f'<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="2" CELLPADDING="1">'
             f'<TR><TD FIXEDSIZE="TRUE" WIDTH="{ICON_PT}" HEIGHT="{ICON_PT}">'
             f'<IMG SRC="{img}" SCALE="TRUE"/></TD></TR><TR><TD>{text}</TD></TR>'
             + (f'<TR><TD HEIGHT="{gap}"></TD></TR>' if gap else "") + '</TABLE>>')
    return Node(label, shape="plain", fixedsize="false", style="")


def vendor_grid() -> Node:
    """One node: the five mock vendor APIs as a logo grid, so they take one slot, not five."""
    names = [("stripe", "Stripe"), ("ramp", "Ramp"), ("quickbooks", "QuickBooks"),
             ("gusto", "Gusto"), ("hubspot", "HubSpot")]
    size = 64

    def cell(name: str, title: str) -> str:
        return (f'<TD><TABLE BORDER="0" CELLSPACING="0" CELLPADDING="2"><TR>'
                f'<TD FIXEDSIZE="TRUE" WIDTH="{size}" HEIGHT="{size}">'
                f'<IMG SRC="{ICONS / (name + ".png")}" SCALE="TRUE"/></TD></TR><TR><TD>'
                f'<FONT POINT-SIZE="21" FACE="{FONT} Medium" COLOR="{INK}">{title}</FONT>'
                f'</TD></TR></TABLE></TD>')

    row1 = "".join(cell(*n) for n in names[:3])
    row2 = "".join(cell(*n) for n in names[3:])
    label = (f'<<TABLE BORDER="2" COLOR="#93C5FD" BGCOLOR="#EFF6FF" STYLE="ROUNDED" '
             f'CELLBORDER="0" CELLSPACING="10" CELLPADDING="4">'
             f'<TR><TD COLSPAN="3"><FONT POINT-SIZE="27" FACE="{FONT} Medium" COLOR="{INK}">'
             f'Mock vendor APIs</FONT><BR/><FONT POINT-SIZE="21" FACE="{FONT}" COLOR="{MUTED}">'
             f'shaped like the real ones · simulator-generated books</FONT></TD></TR>'
             f'<TR>{row1}</TR><TR>{row2}<TD></TD></TR></TABLE>>')
    return Node(label, shape="plain", fixedsize="false", style="")


def box(title: str, subtitle: str, fill: str, line: str) -> dict:
    """Cluster style with a bold title and a muted subtitle line."""
    label = f'<<FONT POINT-SIZE="32" FACE="{FONT} Bold" COLOR="{INK}">{escape(title)}</FONT>'
    if subtitle:
        label += (f'<BR ALIGN="LEFT"/><FONT POINT-SIZE="22" FACE="{FONT}" COLOR="{MUTED}">'
                  f'{escape(subtitle)}</FONT>')
    label += '<BR ALIGN="LEFT"/>>'
    return {"label": label, "bgcolor": fill, "pencolor": line, "penwidth": "2.5",
            "style": "rounded", "labeljust": "l", "margin": "22"}


def flow(label: str, color: str, **kw) -> Edge:
    # Per-edge font attrs: diagrams' Edge sets its own defaults, which beat edge_attr.
    return Edge(label=f" {label} ", color=color, fontcolor=color, fontsize="27",
                fontname=f"{FONT} Medium", **kw)


def legend() -> str:
    item = '<FONT POINT-SIZE="28" FACE="{f} Bold" COLOR="{c}">━━ {t}</FONT>'
    gap = '<FONT POINT-SIZE="28">        </FONT>'
    items = gap.join(item.format(f=FONT, c=c, t=t) for c, t in [
        (DATA_IN, "data in"), (AI, "AI calls"), (RESULT, "results to the UI"),
        (CONTROL, "people and timers")])
    return (f'<<FONT POINT-SIZE="56" FACE="{FONT} Bold" COLOR="{INK}">Domino system architecture'
            f'</FONT><BR/><FONT POINT-SIZE="28" FACE="{FONT}" COLOR="{MUTED}">From simulated books '
            f'to a live 13-week cash forecast. Domino reads only; it never moves money.</FONT>'
            f'<BR/><BR/>{items}<BR/>>')


def build(out: Path, formats: list[str]) -> None:
    graph_attr = {
        "label": legend(), "labelloc": "t", "labeljust": "c",
        "bgcolor": "#FFFFFF", "pad": "0.6", "nodesep": "0.35", "ranksep": "0.9",
        "splines": "spline", "compound": "true", "newrank": "true", "dpi": "90",
    }
    edge_attr = {"fontname": f"{FONT} Medium", "fontsize": "31", "penwidth": "3.2",
                 "arrowsize": "1.1"}
    hide = {"style": "invis"}

    with Diagram("", filename=str(out), show=False, outformat=formats, direction="LR",
                 graph_attr=graph_attr, edge_attr=edge_attr):

        with Cluster("sources", graph_attr=box("Data sources", "", "#F8FAFC", "#CBD5E1")):
            vendors = vendor_grid()
            nessie = icon("capitalone", "Capital One", "Nessie sandbox (real)")

        with Cluster("ai", graph_attr=box("AI and tool APIs", "real services",
                                          "#FAF5FF", "#C4B5FD")):
            creao = icon("creao", "CREAO", "agent runs")
            claude = icon("claude", "Anthropic Claude", "fallback + Ask Domino")
            apify = icon("apify", "Apify", "public web search")

        with Cluster("convex", graph_attr=box("Convex backend", "", "#FFF7ED", "#FDBA74")):
            clock = icon("scheduler", "Scheduled functions", "sim clock ticks")
            http = icon("http", "HTTP actions", "signed vendor webhooks")
            with Cluster("agents", graph_attr=box("Agents", "run inside Convex actions",
                                                  "#F0FDFA", "#5EEAD4")):
                ingest = icon("ingest", "Ingestion agent", "maps every tool's records")
                audit = icon("audit", "Audit swarm", "7 parallel checkers")
                analyst = icon("forecast", "Forecasting swarm", "stress scenarios + advisors")
                creao_steps = icon("coordinator", "CREAO steps", "coordinator · flag explainer")
                toolbox = icon("toolbox", "Apify toolbox", "counterparty research")
                tl_analysis = icon("analysis", "Timeline analysis", "Ask Domino answers")
            mutations = icon("mutations", "Mutations")
            db = icon("database", "Convex DB", "schema: Field · Timeline · Legacy")
            queries = icon("queries", "Reactive queries", "useQuery subscriptions")

        with Cluster("engine", graph_attr=box("Engine", "pure TypeScript: same input, same output",
                                              "#EEF2FF", "#A5B4FC")):
            forecast = icon("engine", "Cash engine",
                            "13-week forecast\ncash flow statement\nrecurring revenue")
            dominoes = icon("engine", "Risk engine",
                            "dominoes · stress tests\nscore-fix · quarterly backtest")

        with Cluster("users", graph_attr=box("Users", "", "#F8FAFC", "#CBD5E1")):
            user = icon("user", "Finance lead / Judge", "reviews · approves · asks")

        with Cluster("frontend", graph_attr=box("Frontend", "Next.js + React · Tailwind",
                                                "#F8FAFC", "#94A3B8")):
            dashboard = icon("dashboard", "Dashboard")
            worker = icon("worker", "Worker", "suggestions · risks · flags")
            brain = icon("brainmap", "Brain map", "+ Connected tools")
            timeline = icon("timeline", "Timeline", "+ Ask Domino")
            tryit = icon("tryit", "Try it", "+ 2U backtest")


        # Data in. Edges written right-to-left use << so the layout still reads left to right.
        vendors << flow("advance one day", CONTROL) << clock
        vendors >> flow("new entries (webhooks)", DATA_IN) >> http
        vendors >> flow("books snapshot", DATA_IN) >> ingest
        nessie >> flow("bank transactions", DATA_IN, headport="w") >> ingest
        http >> flow("starts ingest", DATA_IN) >> ingest
        clock >> flow("tick", CONTROL) >> ingest
        ingest >> flow("new snapshot", DATA_IN) >> audit
        ingest >> flow("snapshot", DATA_IN) >> analyst

        # Deterministic money math.
        analyst >> flow("scenarios", DATA_IN) >> forecast
        analyst << flow("cash forecast", RESULT) << forecast
        # xlabel: placed after layout at the edge's midpoint, clear of the crowded agent column.
        audit >> Edge(xlabel=" pure checks ", color=DATA_IN, fontcolor=DATA_IN, fontsize="27",
                      fontname=f"{FONT} Medium") >> dominoes

        # AI.
        audit >> flow("explain flags", AI) >> creao_steps
        analyst >> flow("plan · pick a fix", AI) >> creao_steps
        analyst >> flow("research", AI) >> toolbox
        creao_steps >> flow("agent runs", AI) >> creao
        creao_steps >> flow("fallback", AI, style="dashed") >> claude
        toolbox >> flow("news search", AI) >> apify
        tl_analysis >> flow("answers", AI) >> claude

        # Results to the UI.
        creao_steps >> flow("explanations", RESULT) >> mutations
        analyst >> flow("forecasts · suggestions", RESULT) >> mutations
        audit >> flow("flags", RESULT) >> mutations
        # Mutations, DB and queries share one column: same-rank edges do not add ranks.
        mutations >> flow("write", RESULT, constraint="false") >> db
        db >> flow("changes", RESULT, constraint="false") >> queries
        for node in (db, queries):
            creao_steps >> Edge(**hide) >> node
        queries >> flow("live updates", RESULT, lhead="cluster_frontend") >> brain
        for page in (dashboard, worker, timeline, tryit):
            queries >> Edge(**hide) >> page
        dominoes >> flow("2U backtest", RESULT) >> tryit

        # People.
        # The person sits in the Frontend column (same rank as the pages), right above them,
        # so the Users box needs no arrow into the pages.
        queries >> Edge(**hide) >> user
        mutations << flow("start agents · accept", CONTROL) << worker
        tl_analysis << flow("Ask Domino question", CONTROL) << timeline


def pad_to_16_9(png: Path) -> None:
    """Center the drawing on a white 16:9 canvas (needs ImageMagick; skipped without it)."""
    magick = shutil.which("magick")
    if not magick:
        print("ImageMagick not found: PNG left at its natural aspect ratio")
        return
    size = subprocess.run([magick, "identify", "-format", "%w %h", str(png)],
                          check=True, capture_output=True, text=True).stdout.split()
    w, h = int(size[0]), int(size[1])
    w, h = max(w, round(h * 16 / 9)), max(h, round(w * 9 / 16))
    subprocess.run([magick, str(png), "-background", "white", "-gravity", "center",
                    "-extent", f"{w}x{h}", str(png)], check=True)


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
    build(args.out, formats)
    if "png" in formats:
        pad_to_16_9(args.out.with_suffix(".png"))
    if "svg" in formats:
        inline_svg_images(args.out.with_suffix(".svg"))
    for fmt in args.formats.split(","):
        print(args.out.with_suffix(f".{fmt}"))


if __name__ == "__main__":
    main()
