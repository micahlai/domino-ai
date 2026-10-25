# Icons

Shared icon set for any screen that shows data sources, agents or tool calls. Import from
`@/components/icons`. No icon dependency beyond `lucide-react`.

| Component | Use for | Key prop |
| --- | --- | --- |
| `ToolLogo` | A data source or vendor (Stripe, Ramp, QuickBooks, Gusto, HubSpot, Plaid, Capital One, bank, generic) | `vendor`: a `VendorId` or any alias the app uses (`"cards"`, `"nessie"`, `"qbo"`) |
| `AgentIcon` | Who did the work: `domino`, `claude`, `creao`, `system`, `simulator`, `person` | `kind` |
| `ToolIcon` | What kind of tool call: `read`, `map`, `save`, `audit`, `forecast`, `export`, `simulate`, `connect`, `other` | `category`, `tile` |

```tsx
<ToolLogo vendor="stripe" size={32} />
<AgentIcon kind="claude" />
<ToolIcon category="save" tile size={28} />
```

- `vendorFor(name)` maps connector ids, field log source kinds and catalog ids to one vendor.
- Labels for legends and panels: `VENDORS[id].name`, `AGENT_KIND_LABEL`, `TOOL_CATEGORY_LABEL`.
- Brand tiles are simplified hand-drawn marks (letterform or reduced mark on the brand color),
  meant to identify a source at 16 to 40 px. They are not official logo files.
- The CREAO glyph is a neutral placeholder (lucide `Blocks`), not CREAO's logo. Swap it in
  `AgentIcon.tsx` if the official mark is added to the repo.
- Every icon is decorative (`aria-hidden`) unless you pass `title`, which makes it an image with
  that accessible name. Agent tints use theme tokens where possible, so they follow the theme.
