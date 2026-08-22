# 15 — Player-side season scoping, and the season claim

The player side learns about seasons, and a phone claims its racer once a season
instead of every game night.

**Depends on:** 13, 14.

**Model: `docs/seasons-and-teams.md` — "Routes and UI / Player side".**

## The root does not become a season picker

Decided with the user, and it is the decision most likely to get quietly
reversed by someone who reads the original request literally.

`AGENTS.md` is explicit that `/` is the one URL anyone has to know and that it
must not behave differently week to week — the same reasoning that already
forbids auto-redirecting to a single live race. A picker page makes the root a
different page at every season rollover and adds a tap to every game night for a
league with one active season.

**So `/` stays a list of races, with the season named in the header and a
switcher beside it.** Same shape forever, deep links still work, and the season
is a control on the page rather than a door in front of it.

"Current season" is the newest non-archived one, or an explicit
`seasons/{id}.current` flag if the commissioner wants to pin it.

## Routes

```
/                              current season's races + switcher   (unchanged shape)
/season/:seasonId              that season's races — the same page, explicit
/season/:seasonId/standings    per-season standings
/standings                     → redirects to the current season's standings
```

The redirect goes **straight to the current path**, never chaining — the
tablets have old URLs bookmarked and a second round trip on house wifi buys
nothing. That convention is already in `AGENTS.md` and `next.config.ts`.

`app/RaceList.tsx` keeps its `variant` prop and gains `seasonId`. `useRaceList`
grows a `where("seasonId", "==", id)` and stops streaming every race in the
database — this is what item 13's composite index is for. `useStandings` scopes
the same way.

## The season claim

Decided with the user. `SeasonMember.claimedBy` holds the durable claim;
`createRace` and `joinRace` **seed** `participants/{id}.claimedBy` from it.

The race-level claim stays authoritative in-race and stays re-tappable, so a
stale claim from a borrowed tablet or a cleared browser is one tap to fix. "My
racer" is still *derived* — the participant whose `claimedBy` matches this
device's uid — exactly as `AGENTS.md` requires. Nothing is stored about "which
racer is mine"; the season claim is a default, not a second source of truth.

```ts
claimSeasonRacer(seasonId, playerId, uid, currentlyHeld, who)
```

Same transaction shape as `claimRacer`: re-read `claimedBy`, refuse a racer
another uid holds, release the caller's current one in the same transaction, and
have the caller pass what it currently holds — **the web SDK cannot run a
collection query inside a transaction**, so that value is verified before being
cleared and a stale one can never free someone else's claim.

Today the uid is a device, not a person. When Phase 2 brings Google accounts
this becomes a real person-to-racer link, which is the shape to build toward —
and `useUid()` is still the only place identity is read from.

## Acceptance

- `/` is still a list of races and still never redirects; the season is a
  switcher in the header.
- `/season/:id` and `/season/:id/standings` work cold, on a phone, from a
  bookmark.
- `/standings` redirects straight to the current season's standings.
- The race listener is scoped to one season and uses the index.
- Claiming a racer once persists across that season's races; the in-race claim
  still overrides and still refuses a racer someone else holds.
- Two phones claiming the same racer at once: one wins, one gets told why.
