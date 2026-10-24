# V4: Hide disabled particles

- **Goal:** Turning particles off removes them instead of freezing a visible frame.
- **Folder:** `apps/web/components/multiverse`
- **Contracts used:** None changed.
- **Done when:** The canvas clears when disabled, stays clear across selection/scale/fix updates, and emits again when enabled; chart interactions continue; checks and browser review pass.
- **Notes:** design-spec §3.4. Reuse the current P5/P6 worktree and existing playground. Label the control Hide particles / Show particles so its scope is clear.
