# House rules and rulings

The corpus for the rules chatbot (Phase 4). **This file is the blocker for that
feature**, and it's the only input in the whole project that can't be backfilled
later — rulings live in people's heads and evaporate within a week or two.

Add to it as things come up at the table. It costs nothing now and can't be
reconstructed afterwards.

## How to write an entry

Record the *situation* and the *decision*, not just the rule. The chatbot needs
to recognise a similar situation later, and "why" is what makes a ruling
extensible to cases nobody has hit yet.

```markdown
### Short name for the situation

**Situation:** what actually happened at the table
**Ruling:** what we decided
**Why:** the reasoning, if there was any
**Date:** when
```

Contradicting an earlier ruling is fine — add the new one and note that it
supersedes. The history is useful; don't delete the old entry.

---

## Rulings

_None recorded yet._

---

## Standing house rules

House rules agreed up front, as opposed to rulings made in the moment.

### Turn timer

Each turn has a countdown, shown on the main screen. It's a pace-keeper only —
running out carries no penalty. Amber under 30 seconds, red at zero.

### Scoring

Season points are configured per-season in Firestore (`seasons.scoringConfig`)
rather than fixed in code, so they can change between seasons without a deploy.
Record here what each season actually used, and why, if it changed.

_Season 1: not yet configured._
