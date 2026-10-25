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
    with graph("DOMINO / PLANNED COMPLETE DEMO\nBlue = retained  |  Amber dashed = unfinished work", out / "domino-planned"):
        with Cluster("Frontend", graph_attr=box(PLANNED)):
            ui = React("Next.js + React\nLive map + conversation\nSaved simulations + impact chart")
        with Cluster("Backend", graph_attr=box(PLANNED)):
            flow = Server("Convex durable execution\nValidated capability choices\nRetries + records + cutoff boundary")
            source = Document("Versioned company evidence\nCurated 2U source first\nSeparate pre-cutoff and reveal data")
            engine = TypeScript("Domino financial engine\nBaseline / Event / Response\nCosts + timing + uncertainty")
            boundary = Action("CREAO boundary\nVerify identities + isolation\nValidate plans and specialist output")
        with Cluster("Database", graph_attr=box(PLANNED)):
            db = Database("Same Convex database\nImmutable scenario branches\nEvidence, profiles, jobs and results")
        with Cluster("External APIs", graph_attr=box(PLANNED)):
            coordinator = Server("CREAO coordinator\nSelect allowed capabilities\nBounded decisions and follow-up")
            specialists = Action("CREAO specialists\nEvidence analysis\nCosted-response review")

        ui >> link("Question + explicit scenario request", "planned") >> flow
        source >> link("Frozen facts + source dates") >> flow
        flow >> link("Validated scenario input", "planned") >> engine
        engine >> link("Computed branches + causal basis", "planned") >> flow
        flow >> link("Persist immutable scenario records", "planned") >> db
        db >> link("Reactive results + real job events", "planned", constraint="false") >> ui
        flow >> link("Allowed task + cutoff packet", "planned") >> boundary
        boundary >> link("Bounded plan request", "planned") >> coordinator
        coordinator >> link("Capability choices", "planned", constraint="false") >> boundary
        boundary >> link("Actual app jobs", "planned") >> specialists
        specialists >> link("Cited results", "planned", constraint="false") >> boundary


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
