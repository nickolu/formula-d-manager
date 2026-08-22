# 18 — Teams, player side

A player sees their team and teammates, and — when the commissioner allows it —
joins, leaves, renames and recolours.

**Depends on:** 17.

**Model: `docs/seasons-and-teams.md` — "Teams, on a player's phone", §6.**

## Where it lives: inside My racer, not a fourth tab

The panel needs to know who *you* are, which is the claim. A standalone Team tab
would open on "claim a racer first" — which is the My racer screen with extra
steps. `PlayerTabs` stays three tabs.

Below the car card in `MyRacerView`:

- your team's colour bar and name, tappable to rename/recolour when
  `playerManaged` is on,
- teammates: name, current position, laps, DNF badge, season points,
- with no team: joinable teams showing `n/teamSize`, **full ones greyed rather
  than hidden** — seeing that Ferrari is full is information,
- **"Leave team": muted, small, and never beside anything else.** Same reasoning
  as the reverse gear — a rare, hard-to-undo action does not sit next to a
  target a thumb is aimed at all night.

Between game nights there is no race to be in, so the same panel stands alone
outside a race. Both render the same component; do not fork it.

**Amended after shipping:** that standalone home is **`/season/:seasonId/racer`**,
below the season-level racer picker, not `/season/:seasonId/teams` — which
redirects there. The reasoning is this item's own, applied one level up: the
panel has to know who you are, so it belongs under the screen where you say who
you are rather than beside it. The season subnav is Races / Racer / Standings,
and Teams is deliberately not a tab on it for exactly the reason it is not a
fourth tab in-race.

Teams are season-scoped and the player view is race-scoped — `race.seasonId`
bridges it, with one listener each on the season's teams and members.

## "Players can manage teams" is a mode, not a permission

There is no real auth until Phase 2, so `playerManaged` cannot *stop* anyone
from renaming any team — the same honesty as `AGENTS.md`'s line about `/admin`
not being hidden, and the same as item 11's car card having no permissions.

What `lib/` *can* enforce, and should, is the soft check that actually works: **a
player may edit the team they are on**, resolved through their claim. That is a
real constraint at a real table. **Comment it as not being security**, so nobody
later mistakes it for one and builds on top of it.

## Acceptance

- With teams off, or `playerManaged` off, the panel is read-only and no
  join/leave/edit controls render.
- A player with no team sees joinable teams with slot counts; full teams are
  visible and disabled.
- Joining fills a slot and is visible on other devices without a reload.
- Leaving is reachable but not adjacent to anything else.
- A player cannot rename a team they are not on.
- Teammate rows show live position, laps and DNF during a race.
- `/season/:id/teams` works cold, on a phone, with no race in progress.
- Usable one-handed at phone width.
