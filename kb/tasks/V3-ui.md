# V3: Dialog test compatibility

- **Goal:** Reuse the existing shadcn Dialog in the timeline and SSR tests.
- **Folder:** `apps/web/components/ui`
- **Contracts used:** None.
- **Done when:** Dialog utils import uses the same relative path as Button; behavior unchanged.
- **Notes:** Routine scope addition approved by parent agent; change only the import in dialog.tsx.
