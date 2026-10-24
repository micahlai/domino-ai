---
name: demo-check
description: Run the Domino demo script end to end and report what breaks. Use at every gate and before recording the video.
---

# Demo check

1. Reset: `pnpm seed`, then open the app on a fresh browser profile.
2. Follow `kb/product/demo-script.md` step by step with a timer.
3. For each step, record: works / slow (> 2 s) / broken, plus what you saw.
4. Try one judge scenario from `kb/scenarios.md` with "Add event".
5. Check fallbacks: cached results load if agents are slow; backup video exists.
6. Write the result as a handoff entry and set board rows to `blocked` for anything broken.

Total time must be under 3 minutes. If it is not, cut words, not steps.
