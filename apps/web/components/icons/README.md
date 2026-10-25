# Icons

Shared icon set for any screen that shows data sources, agents or tool calls. Import from
`@/components/icons`.

| Component | Use for | Key prop |
| --- | --- | --- |
| `ToolLogo` | A data source or vendor (Stripe, Ramp, QuickBooks, Gusto, HubSpot, Plaid, Capital One, Apify, bank, generic) | `vendor`: a `VendorId` or any alias the app uses (`"cards"`, `"nessie"`, `"qbo"`) |
| `AgentIcon` | Who did the work: `domino`, `claude`, `creao`, `system`, `simulator`, `person` | `kind` |
| `ToolIcon` | What kind of tool call: `read`, `map`, `save`, `audit`, `forecast`, `export`, `simulate`, `connect`, `apify`, `other` | `category`, `tile` |

```tsx
<ToolLogo vendor="stripe" size={32} />
<AgentIcon kind="claude" />
<ToolIcon category="apify" tile size={28} />
```

- `vendorFor(name)` maps connector ids, field log source kinds and catalog ids to one vendor.
- Labels for legends and panels: `VENDORS[id].name`, `AGENT_KIND_LABEL`, `TOOL_CATEGORY_LABEL`.
- Every icon is decorative (`aria-hidden`) unless you pass `title`, which makes it an image with
  that accessible name.

## Where each mark comes from

Official marks only. Nothing here is redrawn by hand except the generic fallbacks (lucide).

| Mark | Source | Rendered as |
| --- | --- | --- |
| Stripe, HubSpot, QuickBooks, Gusto | [`simple-icons`](https://simpleicons.org) npm package (CC0; paths from each brand's own guidelines) | White path on the brand color from Simple Icons |
| Claude (Claude agents) | `simple-icons` `siClaude` (source: https://claude.ai) | Claude orange path on a light tile |
| Ramp | `public/logos/ramp.png`, apple-touch-icon from https://ramp.com/apple-touch-icon.png | Image on its own yellow |
| Plaid | `public/logos/plaid.png`, apple-touch-icon from https://plaid.com/assets/img/favicons/apple-touch-icon.png | Image on its own dark teal |
| Capital One | `public/logos/capitalone.svg`: the red swoosh path cut from the site header logo at https://www.capitalone.com/ (full logo kept as `capitalone-logo.svg`) | Swoosh on white |
| Apify | `public/logos/apify.svg`, site icon from https://apify.com/icon0.svg | Image on white; also the `apify` tool category glyph |
| CRS (identity and fraud checks) | `public/logos/crs.svg`, site icon from https://crscreditapi.com/favicon.svg (downloaded 2026-10-25) | Image on white |
| CREAO (CREAO agents) | `public/logos/creao.png`, apple-touch-icon linked from https://creao.ai/ (`https://framerusercontent.com/images/9zsrqw9UJOMzHL6gJdrw4pJyABQ.png`) | Image on white |
| Domino (Domino agents) | The app's own mark, `public/domino-logo.svg`, inlined | Mark on a light green tile |

Simple Icons does not ship Ramp, Plaid, Capital One, Apify or CREAO (checked against
simple-icons 16.35.0), so those come from each company's own website as listed. Downloaded on
2026-10-24. Brand marks belong to their owners and identify the source only.
