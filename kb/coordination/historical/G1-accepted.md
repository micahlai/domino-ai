# G1 accepted: early canvas visual, not complete agent journey

October24 12:37 PDT. Claude implemented90da27c and repair285d7de using /orchestrator, /ponytail full, taste and ui-ux-pro-max. Codex inspected diff, ran full checks/build, and verified actual browser behavior. Merged into preview atdcfb1ab, no main changes.

- Live http://127.0.0.1:3102/investigate, with existing /historical dashboard preserved.
- First view has exactly one idle Domino node, free-form pan/zoom/drag canvas and fixed desktop conversation panel. Node Enter/click opens honest details; no simulated work. Draft persists on device, submit disabled pending backend.
- Reused existing primitives/tokens/icons and installed @xyflow/react12.12.0 for gesture/edge/accessibility infrastructure. No extra theme work, no new layout framework, no financial/backend changes.
- Original candidate and repair each passed820tests/typechecks/lint/build. Combined preview locked install +820tests/typechecks/lint/build passed: /tmp/domino-canvas-preview-{install,check,build}.log.
- Browser1280x800 and375x812 verified node keyboard selection, node drag, draft reload, mobile details clear of controls, Close returning node focus, Fit View capped240px node width at zoom1, no console errors. Current3102 canvas checked after restart. Mobile details use normal flow so the composer may require scrolling while details are open.
- Screenshots: [desktop](screenshots/canvas-preview-desktop.png), [mobile details](screenshots/canvas-repaired-mobile.png). Early screenshot was shown to user before G2 launched.
- Live investigation, specialist calls, saved conversation/operation graph, output chart wiring, reveal and alternative in the canvas are NOT implemented yet. G2a worker is active, then G2b and G3. No completion claim from static tests.
- Reduced-motion preference emulation and touch pinch not runtime-tested; no new animation was added. Mouse drag, explicit zoom controls and keyboard selection were exercised.
