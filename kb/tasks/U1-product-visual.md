# U1: early unified product visual
- **Goal:** show real grouped workspace with Workspace/Company/Simulations navigation and simulation detail tabs before full scenario implementation.
- **Dependency:** G8 inspector audited and integrated. Sole local UI writer, no parallel UI workers.
- **Ownership:** apps/web/app/case/**, app/page.tsx CTA only, components/AppShell.tsx, components/investigate/**, new components/case-workspace/** and related tests; own Result. No historical chart internals, backend, contracts, G7 projection, dependencies/global styles.
- **Routes:** /case/2u workspace, /case/2u/company, /case/2u/simulations, /case/2u/simulations/[conversationId]. Preserve /investigate and /historical direct URLs. Reuse InvestigateLive and CompanyKnowledge/FinancialOutput; retain c/run lineage through navigation. Do not couple public case to Kestrel company ID.
- **Visual:** concise company header plus three main links; full canvas and persistent conversation on Workspace, readable evidence on Company, Overview/Impact chain/Chart/Execution tabs on detail. Real existing conversation/run data only. No fake completed scenarios; list/API or event computation pending states must explicitly say unavailable. Impact chain must not render execution dependencies as financial causation.
- **Quality:** reuse primitives, no theme work or general layout framework. Preserve node details, saved links, errors/offline states, keyboard/focus/reduced motion, mobile fit and quiet history. No technical metadata in default view.
- **Gate:** focused tests/typecheck/lint, commit then STOP. Codex fullcheck/build and actual early visual shown to user before U2 or whole redesign. No browser/provider/fullsuite by worker.
- **Skills:** orchestrator, ponytail, taste, ui-ux-pro-max. Read product-workspace spec. One process, no children.
## Result
- Pending.
