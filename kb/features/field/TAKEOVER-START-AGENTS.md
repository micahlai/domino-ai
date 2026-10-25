# Start agents (idle until started), Oct25

- Branch field/start-agents from field/main 3c2402b, worktree domino-w-start-agents.
- Backend: optional companies.agentsStartedAt. fieldOperating.ensure and fieldJudge.start create idle companies (company, connections, world, sources, feed; nothing scheduled). Started = agentsStartedAt set OR any snapshot exists, so the live 2U baseline needs no migration. field.setup/setupAll still start at once.
- fieldAgents.start({companyId}) is idempotent and queues one ingestRun (trigger "start"); fieldAgents.state returns started/startedAt/connected tools/phase (idle|reading|ready|failed)/analystRunning.
- Guards (ConvexError AGENTS_IDLE "Start agents first..."): fieldClock.play/jump, field.ingestNow, field.setAutoIngest(true), fieldAnalyst.run, judge surprise/scenario/CSV. Webhook receive returns status "agents_idle" without storing; runIngest returns early for idle companies. Judge reset of a started sandbox starts the new one.
- UI: components/field/agents.tsx (gate, idle card, Start button, idle map). Brain map idle shows CREAO coordinator + faded connected tools + Start agents; Dashboard, Worker, Simulations and Timeline (TimelineAgentsGate) show the idle card. Dashboard shows "Working..." skeletons only while the first read runs.
- Checks: web+Convex tsc, all Convex tests (657) + new fieldAgents tests, web vitest 667, Biome on changed files, webpack build. Isolated Convex 3470/3471 + Next 3139 browser run on fresh Taskline: idle pages -> Start agents -> map grew, dashboard populated; Play while idle shows the prompt. Servers stopped. Screenshots in the session scratchpad start-agents/.
- Known: no AI provider env on the isolated backend, so provider steps were skipped/unconfigured there.
