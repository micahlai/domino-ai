ACCEPTED-INTEGRATED d4e24d9e1e66e55fe967dda3977ec3e1f31ae4b7

Merged without conflicts on `preview/historical-overnight`, with the requested message and trailer. Node 24.11.1 direct uncached checks:

| Package | Tests passed | Typecheck |
|---|---:|---|
| contracts | 338 | PASS |
| engine | 201 | PASS |
| sim | 5 | PASS |
| agents | 298 | PASS |
| web | 409 | PASS |
| **Total** | **1,251** | **All passed** |

Root lint passed, 265 files. `git diff --check` passed. Tree clean.

Turbo failed, triggering the requested fallback:

```text
x Failed to create APIClient: Unable to set up TLS.
|-> Unable to set up TLS.
|-> builder error: No keychain is available. You may need to restart your
|   computer.
`-> No keychain is available. You may need to restart your computer.
```

No push, main changes, prohibited path reads, or manual file edits.