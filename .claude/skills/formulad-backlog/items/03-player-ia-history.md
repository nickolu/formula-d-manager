# 3 — Player view information architecture + history subview

Split the player view into subviews and add **history**. This is the item that
establishes the structure items 6, 10 and 11 hang off, so get the routing right
before building anything into it.

**Depends on:** item 2 (the rename).

## Routes, not conditional render

Subviews are real routes. A player lands cold and must be able to reach any
subview by URL, and to reload without losing their place.

```
app/race/[raceId]/player/
  layout.tsx          server component; awaits params, renders <PlayerTabs>
  page.tsx            turn order — the default, what PlayerView renders today
  history/page.tsx
  my-racer/page.tsx   item 10
  settings/page.tsx   item 6
```

`layout.tsx` is a server component that awaits `params` and passes `raceId` to a
`"use client"` tab bar. Page components stay in the established shape: server
page awaits params, hands the id to a `"use client"` child. **A client component
page cannot be `async`.**

Read `node_modules/next/dist/docs/` on layouts and nested routing before writing
this. This Next.js differs from training data and the layout API is exactly the
kind of thing that moved.

## Mobile UI for switching

A **bottom tab bar**, fixed, inside the player layout. Thumb-reachable, which a
top tab bar is not on a phone, and it survives the page scrolling. Use the
current segment (`usePathname`) for the active state.

Do **not** render `app/Nav.tsx` here. It stays opt-in and this view has its own
navigation; the paradigm is that players never leave the player view.

Only create tabs for subviews that exist. Adding item 6's and 10's tabs is part
of those items, not this one — a tab leading to a 404 is worse than no tab.

## The history subview

A reverse-chronological, human-readable rendering of the race event log — the
log is the product, and this is the first view that shows it as such.

- New hook in `lib/hooks.ts`: `useRaceEvents(raceId)` — `onSnapshot` over
  `collection(db, "races", raceId, "events")` with `orderBy("at", "desc")`, and
  a `limit`. One listener, consistent with every other hook in that file.
- Render each `RaceEvent` variant as a sentence. Switch exhaustively over the
  union in `lib/types.ts` so a new event type fails the typecheck instead of
  rendering blank — that is the point of the union.
- Resolve player ids to display names via `usePlayers()`, and use `lib/cars.ts`
  for the car label and colour so a player reads the same everywhere.
- Show `source` for anything not `manual`. Chat-entered entries (Phase 3) are
  the ones most likely to be wrong and the field exists to keep them traceable.
- `correction` events reference `targetEventId`. Render them attached to their
  target where possible, not as an unexplained orphan line.

## Watch out for

- **`at` is `serverTimestamp()` and is `null` in the local snapshot** until the
  server acknowledges the write. With local cache enabled, every event the
  current device writes renders once with a null timestamp. Handle it — don't
  call `.toDate()` on null.
- `uncompleteLap` writes a `correction` with `targetEventId: ""`. Empty is a
  legitimate value meaning "no specific target".
- Events are append-only and never deleted, including those orphaned by a
  deleted race (item 9). History is scoped to one race, so this is not a problem
  here, but do not build anything that assumes an event's race still exists.

## Acceptance

- `/race/:id/player`, `/player/history` each render standalone on a cold load.
- The tab bar is thumb-reachable at phone width and marks the active subview.
- Every event type in the union renders as a sentence; adding a variant to the
  union without handling it fails `npx tsc --noEmit`.
- Pending (null-timestamp) events render without crashing.
