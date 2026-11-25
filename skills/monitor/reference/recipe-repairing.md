# `recipe-repairing`: a stop being fixed is news, never a card

The owner's ruling A: the fleet lets the owner know via a floating card when a job has stopped working but
is being fixed; it never shows up as a queue card or as something blocked on the owner, and a job never silently
stops working. Nothing on disk linked a stopped recipe to the seat repairing it, so a seat says so. The other
monitors: [the monitors](the-monitors.md).

- **The take.** `slopweaver automation repair <recipeId> --row <slug>` appends one line to
  `$SLOPWEAVER_HOME/live/recipe/repairs.jsonl` (`src/live/automation/repairTake.ts`). It refuses a recipe id no
  definition carries, a terminal row and a row no seat has started, since a take naming a dead seat would read as
  fixed while nothing is. The seat is named by the row's slug — checkable in one command.
- **The hold.** A seat RUNNING a stopped row's current firing owns it too: a firing the scheduler reads `held` (a
  live slot lease, its holder not proved gone) is named by its holder, from when that attempt opened, until it
  settles (`src/monitor/stoppedSource.ts` `mergeHeldStops`). A take wins, row and instant both, when both exist.
- **What fires.** Every stopped row, steered or not, whose newest take names a row still non-terminal with an open
  run, or whose current firing is held. Only takes for currently stopped recipes are read, so an old take never
  resurrects a note. One subject for the set: _`<recipeId>` stopped firing — seat `<row>` is repairing it_, or the
  count with each pair below.
- **A notice, not a step the owner takes.** It `floats` and declares `notice`: the step carries no url (it opens no queue
  card) and says nothing waits on the owner, and the hand register refuses a notice carrying a decision, a literal or
  a check-in. `waitingHandSteps` (`src/hand/step.ts`) leaves it off `hand list`, the console queue, `hand push`
  and the Fleet Briefing; the monitor lane still reads it, so it settles like any card.
- **Gone when the repair row is done.** A done, cancelled or rejected row, or a closed run, releases the take by
  itself; the note's step settles and the pass dismisses its floating note (`src/monitor/passSettle.ts`). A recipe
  still silent then reads untaken, and `recipe-stopped` is loud again — never silent in between.
- **Unreadable reads as untaken.** A register that will not open, a line that will not parse or a repair row
  whose doc will not read is named as a blind spot beside the reading; the stop falls to the loud side.
