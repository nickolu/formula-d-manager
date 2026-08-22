# 2 — Rename `device` → `player`

The view players land on should be named for who uses it. Rename everywhere:
route, directory, component, links, and prose.

**Land this in the same commit as item 5.** Both are one redirect pass; splitting
them means editing `next.config.ts` and every internal link twice.

## History that matters

This view has already been renamed once: commit `67f7103` renamed `table` →
`device`, leaving a permanent redirect `/race/:raceId/table` → `/race/:raceId/device`
in `next.config.ts`.

**Repoint that redirect at `/player` directly. Do not chain redirects.** Two hops
is a real delay on a phone on house wifi, and the tablets still have `/table`
bookmarked. Then add a second redirect for `/device` → `/player`.

## Files to touch

- `app/race/[raceId]/device/` → `app/race/[raceId]/player/` (use `git mv`)
- `DeviceView.tsx` → `PlayerView.tsx`, and the component name inside it
- `page.tsx` — the `DevicePage` function name and its import
- `TrackView.tsx` — moves with the directory; no rename needed
- `next.config.ts` — repoint `table`, add `device`
- `app/Nav.tsx` — the `device` link and its label
- `app/RaceList.tsx` — the `device` link and its label
- `AGENTS.md` — the route list, the `Nav.tsx` rationale, the drag-to-reorder and
  track-view bullets all name "the device view"

## Watch out for

- Grep for `device` across the repo before declaring it done, including
  `scripts/smoke.ts` and comments. The word also appears in the honest sense
  ("remembered per device in `localStorage`") — those occurrences stay.
- The `localStorage` key for the list/track toggle: renaming it silently resets
  every tablet's preference. Either keep the existing key or accept the reset
  deliberately, but don't do it by accident.

## Acceptance

- `/race/:id/player` renders what `/race/:id/device` used to.
- `/race/:id/device` and `/race/:id/table` both redirect there in one hop.
- No stale `device` references outside the "per device" sense.
- `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm run smoke` all clean.
