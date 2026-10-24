# Gate check (both, at each gate)

Run by: one agent (Claude Code) on `main`, with both people watching.

## Prompt

```
Load the orchestrator and demo-check skills. We are at a gate (see kb/spec/build-spec.md §11).
1. Pull main. Run pnpm check and report.
2. Run the demo-check skill against kb/product/demo-script.md. Report each step: works / slow / broken.
3. Compare the board (kb/status/board.md) with the gate. List what is missing.
4. Propose cuts if the gate is at risk (add-ons first, then held-out companies; never the main demo flow).
5. Propose the next 2 to 3 tasks per person, in different folders, as task cards in kb/tasks/.
Write a handoff entry with the result. Do not write product code.
```
