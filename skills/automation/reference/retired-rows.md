# Retired rows — a declared row off on this install, on the owner's word

The declaration is the BUILD's ([declared rows](declared-rows.md)); an install may not want every row in it: one machine's employer automations may be turned off or removed, while the
same build elsewhere keeps them. Deleting the file is the absence `automation due` shouts about, written straight back by
`register-standing`; a [hold](holds.md) keeps the row on every page. So the decision is install state:

```bash
slopweaver automation retire <id> --anchor <owner-words anchor> --words "<exact quote>" --why "<why this row>"
slopweaver automation retire <id> --undo     # then `automation register-standing` writes the row back
```

It records the entry in `$SLOPWEAVER_HOME/live/recipe/retirements.json` (`src/live/automation/retirementStore.ts`),
and `declaredStandingRows` SUBTRACTS it: a retired row is neither MISSING nor written back.

- **Only a declared row may be retired**, because `--undo` plus `register-standing` is the restore; nothing could
  restore a hand-written one.
- **`--words` must stand in the owner's record at `--anchor` byte for byte** (`src/live/automation/retirement.ts`):
  origin, as a journalled grant carries it. A general ruling may retire a row the owner did not name; `--why` says why that row.
- **The registry is written FIRST, the canonical `<id>.json` removed SECOND**, both under the definition hold lock,
  so a crash between them leaves a retired row no reader resurrects, and a repeat converges. Until it does, the
  firing view (`loadLiftedRecipeDefinitions`) REJECTS the surviving file, so `run-due`, `claim` and `seat` never fire
  it, and an unreadable registry rejects every row. A dispatcher that loaded its roster before the retirement asks
  again at the take: `rowHeldNow` holds a retired row, and every row while the registry will not read. A rejected
  or duplicated file is refused, never deleted unread.
- **It clears the row's owed finding debt**, and `run-due` skips a retired row's debt; a firing already running
  and a finding already filed are not touched — the seat settles the finding with its own witness.
- **`automation due` names every retired row on one line** and tallies `· N RETIRED on this install`; an
  unreadable registry prints FIRST and compares nothing, since reading it as empty would resurrect every row.
- **The Automations page draws no card for one**: the cards are the definition files, and a retired row has none.
