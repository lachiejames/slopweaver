# `recipe-stopped`: a scheduled post going quiet reaches the owner's screen

When ANY recipe stops firing the owner gets a floating note on the owner's screen and the row high on
the queue, structurally impossible to miss — the bot's most common failure is a cron post that silently stops.
That is `stopsWork` on its registry entry: the card stands under **Stopped automations** every day it stands, even
put off, after only what blocks the owner's priorities and the owner's priorities' own cards (the owner's P0s,
[the owner's priorities](../../../docs/console/queue-focus.md)). Its siblings: [`recipe-repairing`](recipe-repairing.md),
[`corpus-sync-stopped`](corpus-sync-stopped.md) and, for a row stopped on the OWNER's hold, which this card leaves out,
[`automation-held-on-you`](automation-held-on-you.md); every monitor: [the monitors](the-monitors.md).

- **What it reads.** `readSilentRecipeRows` (`src/live/automation/silentRowReader.ts`) joins the definitions, their
  run stamps and the current slot's ledger row — the same join the Fleet Briefing's gone-quiet gate reads. A row
  is watched only when `judgeRecipeDue` gives it no `offReason`, so a **disabled** row and one under an
  **uncleared hold** are never read as stopped: the owner retired them.
- **When it fires.** `silentRows`' own threshold and reasons, with no second number: a row at or above daily
  fires after one whole missed slot (a slot handed to its successor unrun counts), a sub-daily row after two,
  and an unschedulable cadence at once. The card
  carries the reason — `UNSCHEDULABLE`, `DEFERRED`, `NEVER RUN`, `FAILING` or `MISSED` — and its detail.
- **One step for the whole stopped set**, keyed by which rows are in it. Measured, the first real
  `monitor check` read 46 stopped rows: one card each would have been the flood. A row newly stopping, or one
  firing again, changes the set, so the card is re-posted for the new set and the old one settles.
- **The card is a seat's to act on, never the owner's choice**, and the sweep seats it (below): _Seat a repair
  for `<recipeId>` — it stopped firing and no seat has it_, or _for `<n>` recipes, worst `<recipeId>`_ when more
  than one has. The recipe id is fitted to the note's 120-character cap; the sentence around it is never cut. It
  carries no decision, and `src/monitor/card.ts` refuses any monitor card offering two of restart, repair and
  retire. A card recorded while it still carried a decision is re-posted without one, and the old one settles as
  superseded (`src/monitor/openCards.ts` § `undecidedBases`).
- **A stop a seat has taken leaves this card.** `slopweaver automation repair <recipeId> --row <slug>` records the
  take; while that row is non-terminal and its run open, the row is left off the card and counted beside it as
  `repair-taken`, and [`recipe-repairing`](recipe-repairing.md) carries it instead.
- **So does a stop whose current firing a seat is RUNNING.** A firing the scheduler reads `held` — a live slot
  lease whose holder is not proved gone — owns its row exactly as a take does, named by its holder, until it
  settles, expires or loses its holder (`src/monitor/stoppedSource.ts` `mergeHeldStops`; a take wins when both
  exist). The slot ledger keys a firing by recipe id, so an id two definitions share carries no hold and stays on. MEASURED: the sweep seated a repair for `bump-fix-slopweaver` and `slack-owed-daily` while
  two automations seats held both firings; each settled succeeded minutes later.
- **A stop the supervisor holds leaves this card.** A stopped row whose `supervisorStop` is `held` — a
  hold-rationale or held action the chair recorded since its last run (any time, for one never run), on the owner's word or
  a capacity hold, whatever the silence classifier called the gap — is a
  stop someone already chose for, so it is counted beside the card as `supervisor-held`, its reason on the
  Automations page. The set's key is over the open rows only, so a hold landing settles the old card. MEASURED:
  `bump-drive-acme-admin`, held on the owner's word, still kept a card at the top of the owner's Queue. A row only
  passed over (`passed-over`) stays on: nobody said why. A hold stands only until a later tick passes the row over
  without recording one again (`src/live/automation/supervisorStops.ts` § `foldTick`): the sweep records a rationale
  on every due row it holds, so an old hold never silences a row nobody holds now. A hold the chair records this
  tick reaches the ledger at tick close, after this tick's pass, so the card settles on the next tick. A held
  `NEVER RUN`, `FAILING`, `DEFERRED` or `UNSCHEDULABLE` row leaves too (`explainSilentRows`):
  it stayed on before, the "already ruled on but still top" failure. One limit, falling loud: the tick ledger names
  a hold by recipe id, so a held row sharing its id with another definition stays on.
- **The owner's Done holds the set until one of its recipes runs.** Fired every tick, a card the owner closed would come
  straight back as `.2`, so `recipe-stopped` and `recipe-repairing` read a set whose last close was the OWNER's Done as
  `steered` until one of its rows runs after the owner's close — the owner's PRESS, the instant the note's marker
  carries, else the marker file's write time, never the later pass that reads it, so a run between the two counts
  (`src/hand/donePress.ts` § `donePressSettle`). A marker with neither readable is refused, kept for a later pass,
  and its card stays open. A run at the same instant as the owner's close, or a run stamp that will not read, counts as a
  run since: an order that cannot be told falls loud. On `recipe-repairing` a take recorded after the owner's close re-opens
  the note too, since a seat taking the repair again is a repair the owner has not seen. A row joining is a new set and posts; a
  set that shrinks back to one the owner closed reads steered again, and steered rather than held, so the pass settles
  the larger set's card on the way. The pass's own cleared, departed, steered and superseded
  settles are not the owner's, behind a snooze or Later wrapper or not: a set that cleared and came back posts
  (`src/monitor/heldKeys.ts` § `closedByOwner`). The register records no writer, so this is read from the settle's
  TEXT: a Done whose `--did` copies a pass line verbatim reads as the pass's, and the set posts again — loud, never
  silent. A `hand retract` of the card holds the set the same way, which is what a retraction asks for.
- **A steer never silences a stop.** A row a recorded steer covers (`RECIPE_STEERS`, today the steer that every `resync`
  row restarts) stays on the card: the card carries no choice for a steer to answer. MEASURED: while
  steers kept rows off, `monitor check` printed 29 stopped as restarting on the owner's steer, and 22 of them —
  every `resync-atlas-*` row — reached the owner no way at all. Only a corpus resync is left off, counted beside the
  card as `corpus-sync-stopped`, because [that card](corpus-sync-stopped.md) is loud for it; a set whose every row
  is taken, held or a corpus resync reads `steered`, posts nothing and settles an old card as answered.
- **An id the register reads as prose falls back to a plain sentence.** A recipe id is any string, so one such
  as `the session` names the fleet as the actor and the hand register refuses the card. The monitor declares a
  `plainWhat` carrying no id — _Seat a repair for a stopped recipe — its id is below_ — and posts that instead of
  going silent; `unblocks`, which the register only measures, still names the set.
- **Top of the queue, mechanically.** The monitor declares the hand context `work`, which makes the step
  `team-blocked`; inside a tier the Queue draws fresh cards first whatever their kind (`currencyOrdered`,
  `site/lib/cardCurrencyMark.ts`), then the rest in projection order, hand rows ahead of asks, so the step sits above
  every ask that is no fresher than it (`site/__tests__/unit/queueRowsRecipeStopped.test.ts` drives the real
  `rowsOf`). The
  residue: the context switcher is a filter, so with **Slopweaver** selected the row is hidden and counted
  in the page's hidden tally — work is the default context.
- **The floating note.** It `floats`, as `corpus-sync-stopped` does: `monitor check --fire` raises each newly posted
  step's note itself, through the hand register's own raise. Each arrival floats in the next cascade slot,
  beside any note already up, and `--push` keeps a step's own note already up rather than drawing a second panel. A note that fails to come up is reported as its own
  `refused` row; the recorded step stays.
- **A busy register is a retry, not a card.** When another writer holds the hand register's lock, the arrival
  is reported as a `refused` row and nothing is recorded or raised; the next pass posts it. The stopped set is
  never reported clear meanwhile. A clear whose settlement the busy register refused, followed by a recurrence
  before the next pass, reads as one continuous firing: the card stays open naming the set, and the note is not
  raised again.
- **A monitor owns its step ids, by convention only.** The hand register does not reserve `mon-`, so a step
  posted by hand under a monitor's exact id is read as that monitor's card. A recipe-stopped id carries a
  sixteen-hex digest of its set, so nothing but a deliberate copy reaches one.
- **Unmeasurable, never clear**, when the run stamps will not open, no definition is on disk at all, or the hand
  register will not read (without it a set the owner closed would be re-posted over the owner's Done). A definition file that
  will not parse (the row it holds may be the silent one) does not blind the rest: every stopped row still
  readable is carded, the unparseable file is reported as a `refused` row, and nothing settles. None of these
  settles an open card.

## Every tick, and what that leaves

Detection happens when a pass RUNS. Every `supervisor tick open` fires `--only recipe-stopped` and then
`--only recipe-repairing`, so a card is re-judged each tick and settles the tick its set clears. Before that cadence,
a card outlived its subject by 28h at the top of the owner's Queue. MEASURED, a dry pass of each
took about 4s wall (`/usr/bin/time -p slopweaver monitor check --only recipe-stopped`).

The card goes first so a stop a seat took before the tick has its stopped note taken down before the notice rises.
A notice whose note failed to come up, or went down without the owner's press, is raised again by the next fired pass that
finds it off the screen, beside whatever notes are up (`src/monitor/noticeReraise.ts`).

The two are two processes, so each reads its own snapshot. A repair taken between them leaves the card up one
more tick beside the notice, for a stop a seat already has; the next pass settles it. A set whose membership really
churns — a row stopping, running, stopping — posts a card for each new set, one per tick at most, because each is a
change the owner has not seen. A hold the chair records on one tick and not the next changes the set the same way: the
sweep records a rationale on every due row it holds, so that only happens when its own call on the row flips.

## The sweep seats the repair itself

About ten of these notes can land in a day: the notes STAY, and removing them would be a massive misalignment; the
defect is the chair not seating the repairs, so the stop should not have to come to the owner. So the card is never the only thing a stop produces:

- **Tick open seats ONE repair row for the open set, the same tick**
  (`src/cli/commands/supervisor/tickOpenStoppedRecipes.ts`). The open set is the firing one, or a set steered only by the owner's own close: the owner's Done
  holds the card, never the repair. The firing subject and that steer both carry the set as `repair` — the raw
  recipe ids and an EPISODE key covering each row's last run, so a set that ran and stopped again is a new episode.
- **The row** is `repair-stopped-recipes-<episode>-<tick id>`, a p0 `--dispatch` row in the `self` workspace,
  spawned on opus. Its brief tells the seat to `handover start`, take each stop with `automation repair <id> --row
<slug>` — which turns the owner's note into the repairing notice — and not finish until each has run since the take, or a
  question is on the owner's Queue. A row of the episode already on the board is spawned rather than registered again; one
  a live seat holds is left alone.
- **One automatic attempt per episode.** Another doc of the episode on disk, in `handovers/` or its `archive/`, is
  an attempt that ended with the stop standing, so the next attempt is registered and NOT spawned, on that tick or
  any later one: the chair decides. Any run journal of the episode, a board row's own included, is the same:
  `cmux spawn` journals `dispatched` only once its workspace opened, so only a row whose spawn never started is
  spawned again.
- **The note stays up until the take.** Seating does not settle the card; the take does, at the next pass.
- **Nothing it cannot read is acted on.** A reading with a `blindSpot`, an unmeasurable one, or a board that will
  not read seats nothing and says so in the digest; with cmux unread, nothing is registered or spawned, because a seat on the stop cannot be ruled out.
- **Tick close refuses** a tick whose set has neither a seat nor a hold — the sweep contract's step 14.

If nothing runs any pass — the supervisor is not ticking, no session runs `monitor check` — no card arrives,
because this repository ships no external clock: the owner's ruling (no cron, no launch agent) stands, and
reconsidering it is the owner's question. The first pass that does run sees every row past its threshold at once.
