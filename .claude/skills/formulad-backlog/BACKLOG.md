# Backlog status

Statuses: `todo` · `in progress` · `done` · `blocked`

Update this file when an item changes state. It is the only status record.

## Recommended order

Dependency-driven, not priority-driven. Later items assume earlier routes and
fields exist.

| Order | # | Item | Status | Depends on |
|---|---|---|---|---|
| — | 1 | Drag-to-reorder, mobile-first | **done** | — |
| 1 | 2 | Rename device → player | **done** | — |
| 2 | 5 | Rename edit → results | **done** | — |
| 3 | 12 | Player landing + `/admin` split | **done** | 2 |
| 4 | 3 | Player view IA + history subview | **done** | 2 |
| 5 | 4 | Go back a turn (reset + auto-pause) | **done** | — |
| 6 | 6 | Race settings view | **done** | 3, 4 |
| 7 | 7 | Between-rounds pause step | **done** | 6 |
| 8 | 9 | Delete a race | **done** | 6 |
| 9 | 8 | Notes in results | **done** | 5 |
| 10 | 10 | My Racer identity | todo | 3 |
| 11 | 10.5 | Join a race | todo | 10 |
| 12 | 11 | Per-player car status | todo | 6, 10 |

**Land 2 and 5 together in one commit.** They are the same redirect pass and
splitting them means editing `next.config.ts` and every internal link twice.

## Why this order

- The **renames (2, 5)** go first because every later item references the new
  paths. Doing them later means rewriting specs and links mid-flight.
- **12** goes early and is cheap: until the root page points at the player view,
  players have no way to reach the app at all, and every later item is built for
  a screen nobody can get to.
- **3** establishes the subview routing the player view hangs everything off.
  6, 10 and 11 are all subviews of it.
- **4** lands before 6 because it introduces the canonical turn duration field
  that 6's "edit turn seconds" then edits. Doing 6 first means guessing at a
  field 4 will define.
- **6** gates 7, 9 and 11 — each needs a per-race setting and a place to put it.
- **10 before 10.5 and 11**: both need the claimed-racer identity 10 defines.

## Reopened

- **1b — standings rows overflow at phone width.** Verified by screenshot at
  390px: the list rows in the player view (`name · lap · +lap · DNF · ↑ · ↓`)
  are wider than the viewport, so the ↑/↓ fallback sits off-screen for the
  longer names. Item 1's spec says to reopen this as a mobile polish pass
  rather than fix it silently inside another item — so here it is. The track
  rendering does not have the problem. Not blocking anything.

## Open questions

Not blocking, but they will surface. Decide when the item comes up, then record
the answer in the spec file and in `AGENTS.md`.

- ~~**How does a player get the URL?**~~ **Resolved by item 12:** `/` becomes a
  player landing listing races, so the site root is the only URL anyone needs and
  it never changes between game nights. Nothing further to build.
- **Is the settings subview commissioner-only?** There is no auth to enforce it
  with (Phase 2 adds real accounts). Item 9 puts race deletion behind it.
  Interim answer in item 6: keep it reachable but visually separated, and gate
  destructive actions behind confirmation.
- ~~**"If the game has already started"**~~ **Resolved in item 6, confirmed by
  the user:** `scheduled` was given its real meaning. `createRace` writes
  `status: "scheduled"` with the clock stopped, and an explicit `startRace`
  flips it to `live`. The roster is editable only while scheduled.
