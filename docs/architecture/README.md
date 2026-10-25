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
