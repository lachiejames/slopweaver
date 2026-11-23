# `fleet-unhealthy`: the fleet's health, as one note

The owner expects floating notes on the owner's screen when the fleet's syncs are failing across the board or the
bot is not healthy: these are things that need to be escalated to the owner. Declared in `src/monitor/registry.ts`, judged in `src/monitor/fleetHealth.ts`.

## What trips it

Every slot attempt STARTED in the last 24h counts once (`live/recipe/slot-attempts/`), not only each row's
newest — latest-per-row read 19% failing and no deaths on a day that should have tripped, and would not have.

- **`syncs`** — at least 3 runs failed or died, and they are at least a quarter of the day's settled runs.
- **`deaths`** — at least 2 runs died mid-run: an open attempt whose run STARTED, past its lease or with its
  holder pid gone, or a dead letter of `OUTCOME_UNKNOWN` / `KILLED_BY_SIGNAL`. `ATTEMPTS_EXHAUSTED` is a
  failure, not a death, and so is a firing a seat claimed and never started (two such resyncs
  once tripped `deaths` without having run).
- **`bot`** — `bot-off-the-air` fires. An unmeasurable listener is never a trip. A NEVER-ARMED one — no arm
  record, no heartbeat and an empty arm journal, all three read (`listen status` grade `unarmed`; any byte in
  the journal counts, so a torn line still does) — is one `INFO` line at the foot of the Details, never a blind spot, so the note posts. Any other unmeasurable
  listener (a file or journal that would not read, an arm with no beat, a journalled listener cleared before its first
  beat) is a blind spot. A listener whose `armed` journal line fails takes its arm record back
  (`listen/selfRecord.ts`), so no cleared arm can leave an empty journal behind it. Residue: a launch that
  failed before registering and an unsupervised listener (hand-typed, or one whose `armed` line failed; it writes
  none of the three, so its death is undetectable here as on main) look the same, so the line states only the three
  absences — no history, no intent, nothing about what a tag does.

The measured table and its `jq` repro sit on `FLEET_HEALTH_WINDOW_MS`: of six days, the thresholds trip on three
of them and no quieter one.

## What the owner sees

ONE card, its key the tripped signals in order (`syncs-deaths-bot`). Its sentence leads with what CHANGED since
the last note — `2 scheduled jobs newly failing, 1 recovered, 7 still failing` — and its **Details** row opens
every row as `NEW` / `STILL` / `FIXED`, then `PAST` for one that failed or died today and ran clean since (what
a `deaths` trip is usually made of: all nine of one measured trip's were), newest first, how long ago it last failed
and why (the exit and the verb's own closing words, or how it died), led by whose move it is — **Needs you**, with
an **Open its card ›** button to the open hand card it waits on and where that step happens (`in your work
Chrome`, `outside your work Chrome, as <plan email>`, `in a terminal on this Mac, outside Chrome`), or **Nothing
for you**, naming the seat repairing it, its failure hold while one stands (a settled finding lifts it), or its next slot. Both are joined from the open hand
register and the row's failure, never authored ([resync-signed-out](resync-signed-out.md#the-fleet-health-line-says-whose-move-it-is));
the folded row counts them, `▸ Details (5) · 2 need you` — at most 12 lines, the last naming
`monitor check --only fleet-unhealthy`, which prints them all. The footer
carries the numbers as of the pass and what is being done (the repairs a seat has taken). It draws in front of
every note already up, which stays where it is with its title showing above it in the cascade. Without the
bot it is a check-in; with the bot off it is
the owner's act, since only the owner seats a visible bot session (rule 2).

## When it goes up: on a change, paced, while the owner is awake

Ten notes were once re-posted in a few hours because the owner's Done had settled the last, none saying anything
new, so the fleet backs off how often it lets the owner know, without backing off too far: the owner still cares a
lot if something is broken. `src/monitor/fleetHealthDelta.ts` decides:

- **No news, no note.** News is a row newly failing or recovered, a job signal (`syncs`, `deaths`) tripping or
  clearing, or the bot going down or coming back — diffed against what the last POSTED note showed
  (`hand-steps/fleet-health-shown.json`, written only by a FIRED pass after a post, removed when the fleet reads
  clear). The same rows failing again is never news. **A card of the owner's moving is** (`handMoved`), because a note's
  Details are frozen when it goes up: a row now waiting on a card the last note gave no button to, or — only while
  that note is still on the owner's screen — a button whose card has closed. Once the owner has put the note away, with Done or
  a snooze, a closed card raises nothing.
- **07:00–22:00 Australia/Melbourne only**; the night's news waits for the morning, diffed against the last
  note the owner could have read.
- **Spacing**: bad news (a row failing, a signal tripping, the bot down, a card of the owner's moving) waits until 30 min
  after the last note, good news alone until 2h.

A held pass posts nothing and reports a `held` row saying why, so Done means "the next note comes when
something changes", and a snooze brings this one back at the time the owner chose (`hand wake`) unless news re-cuts it
first. With news, the card is RE-CUT as a fresh occurrence even over its own open
card, the old one settled as superseded. `tick close`'s rehearsal holds exactly as the firing pass does, so a
held verdict is clean: the gate never races the owner's Done.

**Residue, named**: "shown" means posted, never seen. A signal set that changed at night or inside the spacing
leaves the old card standing until the note that shows it — so for up to 30 min after the owner's Done on a sign-in, the
note still up can carry a button to that settled card. A memory write that fails after a post costs at most
one extra note. Any blind spot (an unreadable ledger file, memory or listener file) still makes `--fire` refuse
and so `tick close` refuse; a never-armed listener is not one.

## Who runs it

`supervisor tick open` runs `monitor check --only fleet-unhealthy --fire` every tick (reading `fleet-health`,
digest line `fleet health:`), after `--only resync-signed-out --fire` (reading `sign-in-walls`) so a sign-in card
the line names is already up, and `tick close` refuses a tick whose rehearsal would still post a card (a held one is
not), or whose
open card's note is neither up nor taken down by the owner — a raise that failed, a panel that died, a restart — naming
`slopweaver hand show <id>` (`src/supervisor/fleetHealthGate.ts`, hatch `SLOPWEAVER_ALLOW_UNESCALATED_FLEET_HEALTH`).
There is no exception for another note being up: notes stack, so a `meeting-prep-due` or `org-health` note fired
after it on the same tick stands beside it rather than in its place. A note the owner muted (**Never for this kind**) or
holds until worse reads as taken down, so the gate never refuses for it; worse here is more failing automations
than the hold's baseline ([snoozing](../../hand/reference/snoozing.md)).

## Why one day's deaths reached nobody

Every fact was on disk; four gaps kept it there, and each is why a piece above exists.

1. **No pass ran.** Only the hourly `fleet-runs-dry` row ran `monitor check`, `--only` that one, so no
   `mon-recipe-*` card ever posted: hence `tick open` fires its monitors every tick.
2. **A mid-run death writes no record where a reader looks.** `resync-state` is written on completion only and
   `automation due` skips a dead-pid attempt: hence the slot-attempt count.
3. **`bot-off-the-air` was a Queue card, never on the owner's screen**: hence this note floats.
4. **The tick carried no health verdict**: `automation due` names what is due, never outcomes: hence `tick
close` refuses an unescalated trip.
