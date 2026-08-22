# 12 — Player landing page, commissioner moves to `/admin`

Split the root page in two:

- **`/`** — a new landing page. A list of races; tapping one goes straight to
  `/race/:raceId/player`. Nothing else.
- **`/admin`** — everything the root page does today: the new-race form and the
  race list with its device/screen/results links.

**Depends on:** item 2 (the landing links to the player route).

## Why

This is what makes the paradigm reachable. Players land directly on the player
view — but something has to get them there, and per-race links mean the
commissioner distributes a new URL every game night. With this, the site root is
the *only* thing anyone needs: bookmark it once, and tapping your race gets you
to your view.

It also stops the commissioner's tools being the first thing a player sees.

## Files

- `app/page.tsx` — becomes the player landing.
- `app/admin/page.tsx` — new; what `app/page.tsx` contains today
  (`<Nav />`, heading, `<NewRaceForm />`, `<RaceList />`).
- `app/RaceList.tsx` — needs two renderings (below).
- `app/Nav.tsx` — needs a route to `/admin`.

No redirect is needed: `/` still resolves. But the commissioner has to be able
to *find* `/admin` — a link in `Nav.tsx` is enough. There is no auth to hide it
behind and pretending otherwise would be theatre; Phase 2's real accounts are
where this actually gets gated.

## Two renderings of the race list

Keep one component with a variant prop rather than forking it — `useRaces()`,
the ordering, and the empty state are shared, and two copies will drift.

- **Player variant:** the whole row is one large tap target going to
  `/race/:id/player`. No sub-links. Thumb-sized rows.
- **Admin variant:** current behaviour — track, status, and the device/screen/
  results links.

## Which races to show players

`useRaces()` streams every race, newest first. On game night that buries the
live race under months of finished ones by roughly November.

Group them: **live and scheduled races first and visually prominent**, finished
races below under a "Past races" heading (collapsed is fine). Don't filter past
races out — a player tapping into a finished race to see history and results is
legitimate, and item 3's history subview is built for exactly that.

**Do not auto-redirect when there is exactly one live race.** It is tempting and
it saves one tap, but it makes the root URL behave differently week to week and
it strands anyone trying to reach a past race. Make the single live race an
obvious primary target instead.

## Empty state

A player landing when no race exists needs to see something better than a blank
page — say that there's no race yet. Do not put the new-race form here; creating
a race is commissioner work and item 10.5 is how a player gets themselves into
one that already exists.

## Acceptance

- `/` lists races; tapping one lands on that race's player view.
- Live races are prominent; past races are reachable but not in the way.
- `/admin` does everything the old root page did, and is reachable from `Nav`.
- Both work at phone width; the landing is thumb-first.
- No auto-redirect, and no new-race form on `/`.
