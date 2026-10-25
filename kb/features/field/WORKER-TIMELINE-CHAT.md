# Worker suggestions open Ask Domino with context

User request, 2026-10-25. Separate branch `codex/worker-timeline-context`, based on `origin/main` at `0f2874f`. This branch does not absorb the in-progress Timeline reveal work.

- Suggestion actions are Decline and Show on Timeline. Keep the optional note. Historical accepted decisions remain visible as history; viewing a suggestion never records acceptance.
- Decline saves the note using the existing version-checked decision path.
- Show on Timeline opens the pinned company/scenario and an Ask Domino conversation ready to discuss it. Preserve the saved suggestion, risk, fix, engine outcomes, provenance and note as inspectable context.
- Verify company, analyst run, suggestion, snapshot, scenario and fix identities against frozen inputs. Never substitute latest inputs for unavailable older evidence.
- Initialize context without a provider call or action approval. Follow-up LLM requests may read that context as untrusted source data, not instructions. Code still computes every financial result.
- The Timeline Ask Domino header button is the single toggle for its sidebar; duplicate close controls are removed, keeping the draft mounted and Escape focus return.
- Keep this implementation isolated from main and the Timeline branch until explicitly integrated. Existing generic chat storage may be extended through its owned validated receipt; shared contracts and table schema stay unchanged.

Verification: full `pnpm check` passes 2,741 tests, typechecks and lint; Convex TypeScript also passes independently. Scoped tests cover exact saved context, note/retry persistence, wrong source rejection, no implicit acceptance, no provider call on opening, and untrusted-note extraction rejection. Props browser flow verifies Show on Timeline opens Ask Domino with the note and saved context; Decline retains its note in history. Preview is `/playground/worker-timeline`. No new live backend deployment or production-data migration was performed.

Ask Domino retains its existing bounded intent extraction and deterministic forecast answers. Reference evidence is available to follow-up LLM calls; this change does not add broad freeform advisory narration.
