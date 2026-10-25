# Claude lead: pause and goal prompts

Use the existing lead session. Do not start a second lead. Current checkout: /Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-preview, preview/historical-overnight. Read ROADMAP.md and pause-state.md before acting. Codex Goals belong to the Codex chat; this prompt defines Claude's equivalent working contract and does not claim a Claude `/goal` command.

## Current pause

Jayden paused execution. Verified Claude lead PID 64305 was suspended with SIGSTOP. Existing read-only audit children may finish, but no acceptance, merge, new repair or dispatch is authorized while paused. App/backend processes stay running. To resume this exact suspended session later, explicitly authorize resumption, verify PID 64305 still identifies the same Claude cwd, then send SIGCONT. Do not blindly signal a reused PID. A fresh Claude process would duplicate the lead.

## Copyable pause/checkpoint prompt

```text
Pause Domino. No new worker, repair, acceptance, merge or L1 dispatch. Let already-running read-only audits finish if safe. Preserve all worktrees/data/processes. Update ROADMAP.md and HANDOFF.md with exact commits, audit state and the next step, then wait. Main stays untouched, monitor stays PAUSED. Do not treat old run authorization as a resume.
```

## Copyable resume/goal prompt

```text
Resume Domino as the ONE Claude lead in domino-preview on preview/historical-overnight. Read AGENTS.md, HANDOFF.md, ROADMAP.md, kb/coordination/historical/claude-lead-control.md, kb/coordination/historical/user-inbox.md and kb/coordination/historical/pause-state.md. This message explicitly resumes the paused queue; update pause-state/roadmap before dispatch. Inspect actual processes/worktrees/results first. Never start a duplicate lead or friend S2 worker.

You coordinate and delegate feature code. Claude workers implement; Codex independently audits and integrates accepted changes into preview. Keep ROADMAP and HANDOFF current. Acknowledge new user inbox requests at every safe task boundary. At most three active implementation processes including friend/children; one UI writer. Main and existing runtimes/data/secrets stay untouched. Monitor remains PAUSED unless Jayden separately resumes it.

Goal: complete real supported-source company onboarding, conflicting-source reconciliation, scoped versioned feedback that changes later eligible work, honest frozen quarterly forecast evaluation, and the full saved canvas journey including a real bounded CREAO coordinator. Reuse the existing grouped UI, financial chart and backend. Follow kb/spec/learning-loop-design-2026-10-24.md, scenario-persistence-v1.md, required-learning-loop-2026-10-24.md and forecast-evaluation-protocol-v1.md.

First inspect final audit results for L0 06e1c98 and E0 1eb1052. Worker-reported test passes are not acceptance. Both are unaccepted at this checkpoint. If an audit passes, have Codex integrate/check it on preview without touching main. Launch L1 only after accepted L0 and E0 development interfaces. If either fails this third review, stop that workstream and report the exact unresolved findings and options; do not start another repair round without Jayden's direction. Continue only independent work whose dependencies and ownership permit it.

Then follow the ordered roadmap: L1 normalization -> L2 reconciliation -> L3 scoped rules -> L5 durable knowledge; E1 evaluator after its frozen interfaces; S4 durable scenarios after its dependencies and serialized backend ownership; U2 full UI journey and joint activation; verified C2 coordinator; sealed L4 comparison; final combined tests/build/browser/reopen acceptance.

Completion needs observed end-to-end behavior and passing acceptance evidence, not task claims. Keep test outcomes sealed until protocol/dataset/candidate/evaluator identities are fixed. Never tune on exposed test periods and call them untouched. No positive forecast-improvement claim without the preregistered result. If improvement fails, leave L4 open and report the result. No paid fallback/account/developer-wallet calls, purchases, secret exposure or unbounded provider retries. Stop on user pause or a real authority/external blocker, with an exact handoff.
```

Codex Goal lifecycle reference: [official OpenAI documentation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex). A Codex Goal controls its own chat; it does not replace the Claude lead session or resume it automatically.
