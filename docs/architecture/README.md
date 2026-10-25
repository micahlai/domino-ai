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

## System architecture slide (field/main)

`system.py` draws one 16:9 slide of the Domino field app: data sources (mock vendor APIs, Capital One Nessie, CRS), the Convex backend (triggers, agents, learning loop, storage + realtime), the pure TypeScript engine, AI providers (CREAO, Claude fallback, Apify), frontend pages (including Customers and "What Domino learned" on the Worker), users and a tech stack panel. Edge colors: blue data in, purple AI calls, green results to the UI, gray people and triggers, amber learning loop. The learning loop is live on field/main 5c2e16f: flag and fix decisions become scoped rules that the next audit and advisor runs apply. Facts and their source files are listed in the script's docstring.

The graph is built with diagrams, but every container, icon and edge route is set by hand on a grid and rendered with `neato -n2` (Graphviz), so spacing stays even and lines run at right angles around boxes. Move things by editing `BOXES`, `ICON_AT` and `routes()`.

```sh
/tmp/domino-diagrams-venv/bin/python docs/architecture/system.py
```

Output: [domino-system.png](domino-system.png) (about 3840 x 2160, 16:9) and [domino-system.svg](domino-system.svg) (icons embedded). Icon tiles live in `icons/`; `make_icons.py` rebuilds them offline from the committed sources in `icons/src` (simple-icons, lucide-static, the CRS site icon) and the app's own logos in `apps/web/public`.
