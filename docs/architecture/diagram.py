#!/usr/bin/env python3
"""Render Domino's accepted system and planned demo with mingrammer/diagrams.

Run: python diagram.py --out-dir ./generated
Needs Graphviz's `dot` on PATH. No credentials, network or product data are read.
Current means accepted on preview, not everything in an unmerged worker branch.
Generic library icons stand for Convex and CREAO; they do not imply a different
database, cloud provider or vendor. All database nodes represent ONE Convex DB.
"""

import argparse
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.compute import Server
from diagrams.programming.flowchart import Action, Database, Document
from diagrams.programming.framework import React
from diagrams.programming.language import TypeScript


BUILT = "#256D85"
PLANNED = "#B66A12"
GATED = "#B43D4B"
INK = "#172B42"


def box(color: str) -> dict:
    return {"color": color, "penwidth": "1.4", "bgcolor": "#F7FAFD",
            "fontcolor": INK, "fontsize": "17", "fontname": "Helvetica",
            "margin": "52", "style": "rounded"}


def link(label: str, state: str = "built", **kwargs) -> Edge:
    color = {"built": BUILT, "planned": PLANNED, "gated": GATED}[state]
    return Edge(label=label, color=color, fontcolor=color,
                style="solid" if state == "built" else "dashed", **kwargs)


def graph(title: str, output: Path) -> Diagram:
    return Diagram(
        title, filename=str(output), show=False, outformat=["png", "pdf"],
        direction="LR",
        graph_attr={"fontname": "Helvetica", "fontsize": "23", "fontcolor": INK,
                    "bgcolor": "white", "labelloc": "t", "pad": "0.45", "nodesep": "0.75",
                    "ranksep": "1.25", "splines": "spline", "dpi": "150"},
        node_attr={"fontname": "Helvetica", "fontsize": "11", "fontcolor": INK},
        edge_attr={"fontname": "Helvetica", "fontsize": "10", "penwidth": "1.6"},
    )


def current(out: Path) -> None:
    with graph("DOMINO / CURRENT ACCEPTED SYSTEM\nBlue = accepted paths  |  Red dashed = live gate OFF", out / "domino-current"):
        with Cluster("Frontend", graph_attr=box(BUILT)):
            ui = React("Next.js + React\nConversation + grouped map\nCompany evidence + cash chart")
        with Cluster("Backend", graph_attr=box(BUILT)):
            flow = Server("Convex functions\nFixed workflow + durable jobs\nZod validation / cutoff checks")
            source = Document("Bundled 2U disclosures\nFacts + dates + assumptions\nNo live source discovery")
            engine = TypeScript("Pure TypeScript engine\nQuarterly baseline + A1 cost\nCompare later reported results")
            adapter = Action("CREAO adapter code\nStart / poll / validate\nHistorical live acceptance pending")
        with Cluster("Database", graph_attr=box(BUILT)):
            db = Database("Convex / one database\nMessages + operation history\nFrozen runs + separate reveals")
        with Cluster("External APIs", graph_attr=box(GATED)):
            creao = Server("CREAO app API\nDedicated evidence agent exists\nIsolation and live gate unverified")

        ui >> link("Question / reveal / alternative") >> flow
        source >> link("Publication-filtered evidence") >> flow
        flow >> link("Validated frozen inputs") >> engine
        engine >> link("Computed cash + comparisons") >> flow
        flow >> link("Persist work + frozen results") >> db
        db >> link("Reactive queries: state + results", constraint="false") >> ui
        flow >> link("Specialist dispatch path", "gated") >> adapter
        adapter >> link("Start / poll app-scoped jobs", "gated") >> creao
        creao >> link("Coarse status / validated result", "gated", constraint="false") >> adapter


def planned(out: Path) -> None:
    with graph("DOMINO / REQUIRED COMPLETION\nDashed = planned  |  Accuracy and live isolation remain unproved", out / "domino-planned"):
        with Cluster("Preserved frontend", graph_attr=box(BUILT)):
            ui = React("Map + conversation + cash chart\nOnboard / resolve / accept feedback\nSaved simulations + read-only reopen")
        with Cluster("Supported inputs", graph_attr=box(PLANNED)):
            source = Document("Authorized SEC JSON packages\nStandard USD consolidated cash\nVerified accession dates + hashes")
        with Cluster("Domino backend / required additions", graph_attr=box(PLANNED)):
            flow = Server("Convex durable operations\nValidate capability choices\nBounded calls + truthful statuses")
            knowledge = Action("L1 / L2 / L3\nMap / validate / reconcile\nScoped dated feedback rules")
            engine = TypeScript("Pure financial engine\nQuarterly baseline + candidate\nEvent / costed response")
        with Cluster("Same product database", graph_attr=box(PLANNED)):
            db = Database("One Convex database\nVersioned knowledge + feedback\nFrozen runs / jobs / separate reveals")
        with Cluster("External API / isolation gate", graph_attr=box(GATED)):
            creao = Server("Existing CREAO app API\nReal coordinator + specialist jobs\nIdentity / instructions / isolation pending")
        with Cluster("Independent evaluation / evaluator-only data", graph_attr=box(GATED)):
            sealed = Document("Sealed source + outcome custody\nTenable / Varonis proposed\nDataset and candidate seals pending")
            evaluation = Action("L4 paired quarterly comparison\n16 pairs / 5% lower error\nPer-company gate + honest failures")

        ui >> link("Upload / question / feedback", "planned") >> flow
        source >> link("Origin-only records", "planned") >> knowledge
        flow >> link("Recorded knowledge work", "planned") >> knowledge
        knowledge >> link("Resolved roles + eligible rules", "planned") >> engine
        engine >> link("Immutable predictions + scenarios", "planned") >> db
        flow >> link("Messages / receipts / jobs", "planned", constraint="false") >> db
        db >> link("Reactive saved results", "planned", constraint="false") >> ui
        flow >> link("Validated allowlisted tasks", "gated") >> creao
        creao >> link("Actual coarse status + output", "gated", constraint="false") >> flow
        engine >> link("Sealed numeric model versions", "planned") >> evaluation
        sealed >> link("Origin inputs / labels after prediction", "gated") >> evaluation
        evaluation >> link("Approved report only", "planned", constraint="false") >> ui


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path,
                        default=Path(__file__).resolve().parent / "generated")
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    current(args.out_dir)
    planned(args.out_dir)
    for path in sorted(args.out_dir.glob("domino-*.*")):
        print(path.resolve())


if __name__ == "__main__":
    main()
