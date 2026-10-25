# FIELD: Stable map during agent updates

- **Goal:** Live activity updates do not move the map vertically.
- **Folder:** apps/web/components/field; coordination notes in kb only.
- **Contracts used:** No contract or backend change; existing FieldOperation display values only.
- **Done when:** Existing scripted map updates retain a constant map top across short/long activity messages; targeted checks and web build pass; field/main is pushed and3114 remains running.
- **Notes:** /tmp/field-map-before.json reproduces326→350→326px map top while summary height changes24→48→24px; scrollY0 and camera constant. Preserve full message access.

## Result
- Done: Browser regression reproduced then passed;80 after-fix samples across7 activity messages held map top350px, summary48px, scrollY0.63 focused map tests, web tsc, Biome and webpack build pass. Pushed code b07c8c5; live3114 DOM verified fixed48px activity height and full message.
- What changed (files): BrainMap.tsx reserves two activity lines and retains full text in DOM/hover title.
- Watch out: Long summaries visually clamp after two lines; full text is available on hover and to assistive technology. Main/data/protected ports unchanged.
