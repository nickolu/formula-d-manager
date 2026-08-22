# 5 — Rename `edit` → `results`

The corrections screen is where a race gets finished and recorded, so name it for
the output, not the verb.

**Land this in the same commit as item 2.**

## History that matters

Already renamed once: `67f7103` renamed `entry` → `edit`, leaving a permanent
redirect `/race/:raceId/entry` → `/race/:raceId/edit` in `next.config.ts`.

**Repoint that redirect at `/results` directly** — no chaining — and add
`/edit` → `/results`.

## Files to touch

- `app/race/[raceId]/edit/` → `app/race/[raceId]/results/` (use `git mv`)
- `EditView.tsx` → `ResultsView.tsx`, and the component name inside it
- `page.tsx` — the `EditPage` function name and its import
- `next.config.ts` — repoint `entry`, add `edit`
- `app/RaceList.tsx` — the `edit` link and its label
- `AGENTS.md` — the route list and the `table`/`entry` → `device`/`edit` note in
  the status section

## Note

This view is *not* a subview of the player view. It stays a sibling route: it is
the commissioner's finishing and correction screen, and item 8 adds notes to it.
Item 3's tab bar does not include it.

## Acceptance

- `/race/:id/results` renders what `/race/:id/edit` used to.
- `/race/:id/edit` and `/race/:id/entry` both redirect there in one hop.
- All four verification commands clean.
