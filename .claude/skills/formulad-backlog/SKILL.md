---
name: formulad-backlog
description: Work through the Formula D league tool's feature backlog one item at a time — player-view IA, race settings, turn rewind, between-round pause, race deletion, My Racer identity, and car status. Use when picking up any numbered backlog item, when asked "what's next", or when a change touches the player view, race settings, or lib/race.ts mutations.
---

# Formula D backlog

A backlog of 13 tracked changes, each with its own spec file. This skill is the
process for working them: pick one, read its spec, build it, verify it, close it.

**Read `BACKLOG.md` first.** It is the live status board and the only place
status is recorded. Item specs live in `items/NN-slug.md`.

## The paradigm everything hangs off

**The whole app, for a player, is `/race/:raceId/player`. The commissioner's tools live at `/admin`.**

`/` is a player landing page: a list of races, tap one, land on that race's
player view (item 12). So the site root is the only URL anyone needs to know —
one bookmark, and it stays the same every game night.

A player arrives cold — on a phone, with no navigation history and no idea which
racer is theirs. That is the *default* entry state, not an edge case.
Consequences that bind every item:

- The player view is **self-sufficient**. Everything a player does happens
  inside it. It never sends them to `/` or `/admin` to accomplish something.
- **Every subview is its own route**, so a link can land on it directly and a
  reload stays put. No subview may exist only as conditional render state.
- **Mobile-first, one-handed.** Not "responsive down to mobile" — designed at
  phone width first, with the big screen and tablet as the widened case.
- **The shared tablet is no longer a distinct surface.** It is one more instance
  of the player view. `/screen` remains the big screen; `/admin` is the
  commissioner's, and `/` belongs to players.
- **Identity is the cold-start problem.** A visitor with no claimed racer is the
  common case, so item 10 (My Racer) and 10.5 (join race) are the front door,
  not a side feature.

## Working an item

1. Read `BACKLOG.md`, confirm the item is `todo` and its dependencies are `done`.
2. Read `items/NN-slug.md` in full — it carries decisions already made, files to
   touch, and acceptance criteria. Do not re-litigate a decision recorded there;
   if one is wrong, say so and change the spec file in the same breath.
3. Read `AGENTS.md`. It is the architecture rationale and it is authoritative.
4. Build it. Honour the invariants below.
5. Verify (see Verification).
6. Update `BACKLOG.md` status to `done`, and add the *rationale* for any
   non-obvious decision to `AGENTS.md` — that file explains why, and this repo's
   house style is that a decision without a recorded reason gets re-argued later.

Work one item per commit unless a spec says two must land together.

## Invariants — these outrank convenience

Full reasoning is in `AGENTS.md`; this is the short list that gets violated.

- **All state changes go through `lib/race.ts`.** Each function updates the live
  doc *and* appends to the event log in one transaction. Never write race
  documents from a component or a route handler. A new feature that changes race
  state means a new `lib/race.ts` function, not an inline `updateDoc`.
- **Corrections append, never mutate.** Firestore rules reject UPDATE and DELETE
  on event docs, so code that edits history fails at runtime.
- **New event types go in the `RaceEvent` union** in `lib/types.ts`. An event the
  union doesn't know about is invisible to the history view (item 3).
- **`positionOrder` and `roundOrder` stay separate.** Live standings vs. the
  snapshot frozen at round start. Collapsing them re-breaks a bug already fixed
  once.
- **New live-doc fields must be optional** (`field?:`) and every reader must
  handle their absence. Races created before a field existed still have to
  render — there are no migrations here.
- **No board state.** No car positions, no gear, no wear tokens. Humans nudge
  standings. Item 11's car status is a *counter*, deliberately not a board model.
- **The timer is state, not a process.** `turnStartedAt` + `turnDurationMs`,
  derived client-side by `readTimer()`. Never add a countdown, a server tick, or
  extra pause bookkeeping fields.
- **Next 16:** `params` is a `Promise` and must be awaited; a client component
  page cannot be `async`. Server page awaits params and passes the id to a
  `"use client"` child. Every route here already follows that shape.
- **`app/Nav.tsx` is opt-in per page**, never rendered from `layout.tsx`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing
  routing or config code. This Next.js differs from training data.

## Verification

Run all four. The first three must be clean; the smoke test must pass.

```bash
npx tsc --noEmit
npx eslint .
npm run build
npm run smoke         # end-to-end, against real Firestore
```

`scripts/smoke.ts` exercises real transactions and a live listener — the parts
unit tests can't reach. **Any new or changed `lib/` function needs smoke
coverage added there.** There is no Firestore emulator on this machine (needs
Java, not installed), so the smoke test writes to the real project using a
`SMOKE-TEST` race and cleans up after itself.

**Never run `npm audit fix --force`** — it downgrades Next.js to 9.3.3.

For anything with a UI, also check it at phone width. Per the paradigm, that is
the primary case, not a final polish pass.

## Items

| # | Item | Spec |
|---|---|---|
| 1 | Drag-to-reorder, mobile-first | `items/01-drag-reorder.md` |
| 2 | Rename device → player | `items/02-rename-player.md` |
| 3 | Player view IA + history subview | `items/03-player-ia-history.md` |
| 4 | Go back a turn (reset + auto-pause) | `items/04-rewind-turn.md` |
| 5 | Rename edit → results | `items/05-rename-results.md` |
| 6 | Race settings view | `items/06-race-settings.md` |
| 7 | Between-rounds pause step | `items/07-between-rounds.md` |
| 8 | Notes in results | `items/08-result-notes.md` |
| 9 | Delete a race | `items/09-delete-race.md` |
| 10 | My Racer identity | `items/10-my-racer.md` |
| 10.5 | Join a race | `items/10.5-join-race.md` |
| 11 | Per-player car status | `items/11-car-status.md` |
| 12 | Player landing + `/admin` split | `items/12-landing-admin-split.md` |
