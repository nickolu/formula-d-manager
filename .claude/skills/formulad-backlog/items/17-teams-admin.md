# 17 — Teams, admin side

Teams belong to a season. The commissioner enables them, sets the options,
creates the teams and assigns players.

**Depends on:** 13, 14.

**Model: `docs/seasons-and-teams.md` — `TeamConfig`, "Two invariants that need
care", §4, §5, §6.**

## House rules, decided with the user

These delete mechanisms rather than adding them. Do not build for the cases they
forbid.

- **Every team is the same size** (`teamSize`, default 2, configurable because 2
  today is not 2 forever).
- **Nobody switches teams during a season.** So there is **no `result.teams`
  snapshot**, no historical attribution, and `finishRace`/`RaceResult` are
  untouched by this entire arc. Team points are attributed by current
  membership.
- A team change is therefore not a transfer but a **correction of a recording
  error** — the player was always on that team and it was written down wrong —
  and re-deriving the season's team standings is the *right* behaviour for a
  correction. Say that in a comment in item 19's `computeTeamStandings`, or it
  will read as an oversight to whoever finds it next.

## Config, not code

Follows the `scoringConfig`/`carStatus` precedent exactly: in Firestore, absent
means off, existing seasons untouched, no deploy to change a house variant.

```ts
seasons/{id}.teamConfig?: {
  enabled: boolean
  teamSize: number              // default 2
  playerManaged: boolean
  palette: { key, label, hex }[]   // seeded from DEFAULT_TEAM_PALETTE (F1 teams)
  scoring?: "sum" | "average"       // default "sum"
}
```

`scoring` stays even though with equal full teams `average` is `sum ÷ teamSize`
— a monotone transform with an identical ranking. One field and one branch, and
the only case where it matters is the one the house rule forbids and someone
will eventually allow.

Palette `key`s are stable ids and are **never reused for a different colour**.

## Two invariants Firestore cannot check directly

Both are the `claimRacer` problem: **the web SDK cannot run a collection query
inside a transaction**, so anything spanning documents gets denormalized into a
document the transaction can read.

**Membership is written twice.**

- `seasons/{id}/teams/{teamId}.members: PlayerId[]` — the **capacity**
  authority. "Is there an open slot" is `members.length < teamSize`, from one
  doc read.
- `seasons/{id}/members/{playerId}.teamId` — the **exclusivity** authority. "Am
  I already on a team" is one field, from one doc read.

`joinTeam` reads both, checks both, writes both, in one transaction. Neither
invariant can be violated by two phones tapping at once. Same bargain as
`retired` on the live doc.

**Colour uniqueness** spans all teams in the season, so the season doc carries a
claimed-colours map:

```ts
seasons/{id}.teamColors = { ferrari: "team_abc", mercedes: "team_def" }
```

Written by **dot path** (`teamColors.ferrari`), never as a whole map — writing
it whole clobbers a colour claimed a second earlier, the same reason `settings`
toggles are written by dot path today. Released with `deleteField()`. The picker
reads it from a document it already streams, so taken colours grey out with no
extra listener.

Consequence: **the admin cannot remove a palette colour a team currently
holds.** Refuse it in `lib/`, and grey it out in the palette editor.

## Do not enforce equal team sizes in `lib/`

It is a season-wide invariant, so a transaction cannot check it without a query
— and enforcing it would block creating the third team until the first two are
full, which is hostile during the ten minutes the commissioner spends setting
the league up. **Surface it instead:**

- flag uneven teams in the admin Teams section,
- flag a roster that is not a multiple of `teamSize` ("9 members, teams of 2 —
  one player will be teamless").

Shrinking `teamSize` below an existing team's size is **allowed**: it blocks new
joins and kicks nobody. Kicking someone out of a team because a setting changed
is the sort of thing that ends a game night.

## Mutations — `lib/teams.ts`

```ts
createTeam(seasonId, name, colorKey, who)
renameTeam(seasonId, teamId, name, who)
recolourTeam(seasonId, teamId, colorKey, who)   // transactional colour claim
deleteTeam(seasonId, teamId, who)               // releases colour, clears members' teamId
assignToTeam(seasonId, teamId, playerId, who)   // admin path
joinTeam(seasonId, teamId, playerId, who)       // player path, capacity-checked
leaveTeam(seasonId, playerId, who)
```

Every one appends a season event. `joinTeam` and `leaveTeam` are item 18's
player-facing path but belong in this file and are built here.

## The slot grid

Not a dropdown per player. **One card per team showing `teamSize` slots; an
empty slot taps to a picker of unassigned members.** With teams of 2 and a known
roster that is a handful of taps, and an unequal team or a leftover player is
visible at a glance in a way a dropdown never is.

## Acceptance

- Teams off by default; an existing season is untouched until enabled.
- The palette editor refuses to remove a colour a team holds, and says which.
- Two concurrent colour claims: one wins, one is told the colour is taken.
- Two concurrent joins to the last slot: one wins, one is told the team is full.
- A player cannot be on two teams.
- Deleting a team frees its colour and clears its members' `teamId`.
- Uneven teams and a non-multiple roster are flagged, not blocked.
- `teamSize` can be lowered below an existing team's size without kicking anyone.
- Smoke coverage for both concurrency cases — they are the entire reason the
  invariants are denormalized.
