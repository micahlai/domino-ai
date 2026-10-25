# Domino architecture diagrams

> Latest scope: onboarding, source reconciliation, feedback learning and measured forecast improvement are mandatory. Read `kb/spec/required-learning-loop-2026-10-24.md` from the repo root. Earlier deferrals and the smaller planned-demo diagram are superseded. User still launches Claude manually. Monitor was observed PAUSED during chat handoff; do not assume it is active.

See [the shared product plan](../../kb/product/team-reset-2026-10-24.md) for scope, status, order and the Hyphenate gap analysis.

These diagrams document the accepted preview and the expanded required completion, including onboarding, reconciliation, scoped feedback and a separate sealed evaluation boundary. See the [reviewed implementation design](../../kb/spec/learning-loop-design-2026-10-24.md) and [evaluation recipe](../../kb/spec/forecast-evaluation-protocol-v1.md). Dataset/candidate seals and forecast improvement remain pending. They do not imply that unmerged code or gated CREAO calls work. Generic icons represent Convex and CREAO, not additional products. There is one Convex database.

Install Graphviz through your normal package manager if `dot` is not on PATH. Then, from the repo root:

```sh
python3 -m venv /tmp/domino-diagrams-venv
/tmp/domino-diagrams-venv/bin/python -m pip install -r docs/architecture/requirements.txt
/tmp/domino-diagrams-venv/bin/python docs/architecture/diagram.py
```

Optional output location: `python docs/architecture/diagram.py --out-dir /absolute/output/path`.

The script produces current and planned PNG/PDF files under `generated/`. It uses `Diagram`, `Cluster`, labelled `Edge` connections and packaged React, TypeScript, server, document, action and database icons. It reads no product data, credentials or network sources. The Python environment is separate from the application dependencies.

- [Current PNG](generated/domino-current.png)
- [Current PDF](generated/domino-current.pdf)
- [Planned PNG](generated/domino-planned.png)
- [Planned PDF](generated/domino-planned.pdf)

## System architecture slide

`slide.py` draws the current slide (v5) by hand at 1920 x 1080: five columns (Sources, Convex backend, Engine + AI, App, People), color-coded data-flow arrows inside and between them (blue data in, purple AI calls, green results to the UI, orange learning loop), and a tech stack strip. Every card, logo and arrow has exact coordinates in the script; there is no automatic layout. Facts and their source files are listed in its docstring.

```sh
python3 docs/architecture/slide.py
```

Needs only Python 3 and Google Chrome (headless, for the PNG). Output: [domino-system.png](domino-system.png) (3840 x 2160) and [domino-system.svg](domino-system.svg) (logos embedded). Logos come from `icons/src` (simple-icons 16.35.0, lucide-static 1.61.0, CRS site icon) and `apps/web/public/logos`.

`system_v3.py` is the previous Graphviz version (diagrams + `neato -n2`), kept for reference; it writes to `generated/domino-system-v3.*` and uses the tiles built by `make_icons.py`.
