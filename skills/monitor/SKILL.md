---
name: monitor
description: The local Datadog — named conditions over this machine's own ledgers, each one firing the floating macOS card the hand register already draws, plus the cmux notification filter that silences every cmux banner so the floating note is the one surface. Use when asked to watch for a recipe or a corpus sync that stopped firing, to say a seat is repairing a stopped recipe, a Codex plan nothing is signed into, a secret missing beside its stored siblings, a scheduled resync stopped at a sign-in page, every Codex account capped, pull requests backing up, the Slack listener dropping off the air, the supervisor chair sitting on the wrong model, every Claude and Codex plan measured spent until a reset, the Claude or the Codex plans projected to run out before the weekly reset, or an organisation incident starting or changing severity; when asked why cmux notifications are noise, or to make notifications mean something; or to run a scheduled pass that alerts the owner. Phrases like "a recipe stopped firing", "cron post stopped", "scheduled post went quiet", "prs backed up", "codex plan not signed in", "a new secret nobody set", "missing credential", "alert me when", "monitoring and alerting", "local datadog", "too many notifications", "signal to noise", "org health", "incident status", "status page".
argument-hint: "list [--json] | check [--landing <path>] [--only <monitor>] [--fire] [--push] [--now <iso>] [--by-session <text>] | filter <install|show|status> [--hook-script <path>]"
---

Graduated autonomy is supposed to stop things backing up; when it does not, the owner should find out without going
looking: when pull requests back up in the slopweaver repo, a floating macOS note pops up saying so and what the
owner needs to do, a monitoring and alerting system like a local Datadog setup. Delivery is **cmux-native, our own
monitors as verbs over local ledgers.** Two halves, and they are independent: the [filter](reference/the-cmux-filter.md) makes a
banner mean something again, and `monitor check` is what has something to say.

## The pass

```bash
slopweaver github landing --json > /tmp/landing.json     # the one source that is not already local
slopweaver monitor check --landing /tmp/landing.json     # decides, writes nothing, prints what it WOULD do
slopweaver monitor check --landing /tmp/landing.json --push --by-session workspace:29
```

`--fire` posts; `--push` implies it and then runs `hand push`, so one pass's arrivals reach the owner as **one**
banner naming the top one and the count, never one per monitor. Safe on a schedule for the same reason the
push lane is: [arrival only](#arrival-only-no-clock-anywhere).

`monitor list` is the declaration read — every monitor, its source, and what makes it stop. It opens no file.
`--only <monitor>` reads, posts and settles that one monitor alone, leaving every other card as it stands — the
hourly `fleet-runs-dry` row uses it, and every `supervisor tick open` runs `--only turn-signed-out --fire` (also fired by `turn block` and `turn
unblock` themselves), then `--only resync-signed-out --fire`, then `--only recipe-stopped --fire` and `--only
recipe-repairing --fire`, then `--only fleet-unhealthy --fire`, then `--only console-sync-failed --fire`, then `org-health read` and `--only org-health --fire`, then `--only
profile-unloaded --fire`, then `--only steer-at-risk --fire` (a row the owner explicitly steered, at risk: note and voice line, [steer-at-risk](reference/steer-at-risk.md)), then `--only fseventsd-bloated --fire`, then `--only meeting-prep-due --fire`. Fired notes stack, cascaded;
the newest is in front, and `noteLevel` floats the prep page above all in its own cascade ([meeting-prep-due](reference/meeting-prep-due.md)); `handover currency` reads after them all and `hand wake`.

## Arrival only, no clock anywhere

A monitor posts when a subject ARRIVES and settles when it leaves. Not on persistence, not on age. **The open
hand step IS the memory** — there is no second ledger of what has already fired, and `foldArrivals`
(`src/monitor/arrival.ts`) reads no clock at all. So a step the owner settles and a subject that comes back post
again, correctly, and a subject sitting there for a week says nothing more. The register never reuses a
settled id, so a returning subject posts as `<id>.2`, `<id>.3` and so on (`occurrenceId`,
`src/monitor/registry.ts`), and open cards match their subject by base id. Two racing passes can each post one;
the next pass keeps the newest and settles the rest, and a subject that leaves settles all of them. A card
that departs while its monitor still fires records that, naming its replacement — never "the monitor cleared".

That is the owner's ruling that a wait on a person is a STATE and not a countdown, made mechanical in a second lane.

## Four states, because "clear", "already chosen" and "cannot tell" are not the same answer

A reading is `firing`, `clear`, `steered` or `unmeasurable`. `steered` is a stop another card, a seat or a hold
already carries — every row is taken, chair-held, a corpus resync `corpus-sync-stopped` cards, or in a set the owner closed — so no card asks
the owner and an old one settles as answered, never "cleared", while the pass still prints `STEERED` and the count. `unmeasurable` is
the one that earns its keep: an unreadable source **refuses and leaves every open step standing**. Settling on a source that has gone missing would
quietly take a real card off the owner's screen and report success. The one exception reads no source: a step whose
key names an instant already past (`lapsesAt`: `fleet-runs-dry`, `host-week-runs-out` and `meeting-prep-due`) settles on every pass,
measured or not. `fleet-runs-dry` also HOLDS its open card while it fires over the same spent Claude and Codex
plans (`holdsWhileFiring`), so a moved reset never swaps it, as [`host-week-runs-out`](reference/host-week-runs-out.md) holds its projection. Handing in no `--landing` puts `prs-backed-up`
there by construction — this lane opens no network connection of its own, so the document is handed in or the
monitor says it could not tell.

## The card is the owner's action, and the registry is where that is enforced

Every card becomes a row in the hand register, whose gate refuses a sentence naming the fleet as its actor
(rule 10: a session that can do a thing does it). So each monitor's `what` names something only the owner can do, and
the monitors are chosen on the same test — a condition a session would simply fix is not a monitor.
`unit/monitor/registry.test.ts` checks every declared sentence against that gate and against the note's
120-character cap, which is how `chair-off-fable` was caught declaring a card the register would have thrown
out at run time. Each monitor, and why it is genuinely the owner's: [the monitors](reference/the-monitors.md).
The owner's **Never for this kind** mutes a non-notice kind's automatic note and nothing else (`hand mute list|remove`), and a monitor declaring `worsens` also offers **When it gets worse** ([snoozing](../hand/reference/snoozing.md)).

**A card answers the whole posting form, and the store enforces it.** One pass once posted 26 notes: 25
`mon-park-*` cards re-asking parked runs the owner's queue already held as shaped asks, each reading only "Answer: …",
and a recipe card re-asking a choice the owner had steered. A queue card that does not explain, or give the owner the
context for an honest reaction, is useless. So `postingRefusal`
(`src/hand/posting.ts`) runs inside the store's own append for every posted row, and no writer, the monitor
included, can skip a rule `hand post` applies; the roster is pinned by
test, and **no monitor watches a parked run**.

## `recipe-stopped` and `recipe-repairing`: loud until a seat has it, then a note naming the seat

When ANY recipe stops firing, a floating note is on the owner's screen and the row sits at the
very top of the queue. Who acts on it is narrowed: the fleet lets the owner know via a floating card when a job
has stopped working but is being fixed, and it does not show up as a queue card, as something blocked on the owner,
or as a job that silently stops working. So a stopped job is **never the owner's choice**:

- **A stop no seat has taken is loud.** `recipe-stopped` posts one `work`-context step for every live row past
  `silentRows`' own threshold — a disabled or held row is the owner's retirement, never a stop — reading _Seat a repair
  for `<id>` — it stopped firing and no seat has it_, floating and at the top of the queue. It carries no decision.
  A chair-held stop is counted beside it; the owner's Done holds an unchanged set ([recipe-stopped](reference/recipe-stopped.md)).
- **A seat takes one with `slopweaver automation repair <recipeId> --row <slug>`** (`repairs.jsonl`, refusing an
  undefined recipe or a finished or unstarted row), taken while that row is non-terminal and its run open — or by
  HOLDING its current firing: a live slot lease owns the stop until it settles (`mergeHeldStops`).
- **A taken stop is a NOTICE.** `recipe-stopped` reads it `steered` and settles its card as answered;
  `recipe-repairing` floats a note naming the recipe and the seat's row. A notice (`HandStep.notice`) asks
  nothing — no decision, literal or check-in — and `waitingHandSteps` keeps it off `hand list`, the console
  queue, `hand push` and the Briefing. When the row is done, cancelled or its run closes, the note settles and
  is dismissed, and a recipe still silent is loud again.
- **The form refuses a stop offered as a choice.** `src/monitor/card.ts` refuses any monitor card offering two of restart,
  repair and retire, and a card recorded while it still carried a decision is re-posted without one
  (`src/monitor/openCards.ts` § `undecidedBases`).

**Repair is seated ON SIGHT, never asked** (a standing rule): a stopped or failure-held recipe, corpus resync or
atlas resync is one of the commonest ways the setup breaks, so the chair seats a repair row the moment `recipe
due`, `fleet-unhealthy` or a card shows one, and the seat takes it (`automation repair`), fixes the root cause or
re-runs a transient, and settles the hold's finding. It never needs the owner's ask, and a card ASKING the owner is never the
route — an open `recipe-stopped` card means the chair missed one. The one card a stop may raise is
`resync-signed-out`, because a sign-in is the owner's hand. A failure hold reads `HELD by the store` in `automation due`,
quoting its finding's board state: a fix owed by the fleet, unless that finding was settled `declined` — the one
case whose line says only the owner's word lifts it, asked on the Queue ([holds](../automation/reference/holds.md)).

A recorded steer (`RECIPE_STEERS`) keeps NO row off it: a steer answers the choice, never the silence, and once
22 steered `resync-atlas-*` stops reached the owner no way at all. A corpus resync alone is counted beside the card
rather than on it, because its own card is loud; a change to the stopped set (keyed by a sixteen-hex digest of every row serialised as a JSON pair, since six hex and a plain join both collided)
re-posts it, as does a set standing beside another set's leftover card (its settlement failed), whichever is older.
Both raise their own note, as `corpus-sync-stopped` does for a stopped corpus resync even when a steer sends it to the chair — a
steer says who seats one, never that it ran ([the monitors](reference/the-monitors.md)): `--fire` draws each
arrival's note in front of the notes already up, and `--push` adds one banner, closing none of them. Unreadable run stamps or an empty recipe store read `unmeasurable`, never clear; an unparseable
definition still cards every readable stopped row, and settles an old card only when a new one replaced it. An
unreadable repairs register reads as nothing taken, so the stop stays loud and the register is named beside it.

## `codex-plan-signed-out` and `claude-plan-unusable`: a plan the owner pays for that routing is skipping

Falling back off a broken plan stays unasked, and the same moment floats a
top-of-queue card naming the plan by its email, what failed and the owner's one step. One card PER PLAN (`perSubject`), `work`
and `floats`. Codex's routing read files each refusal; `claude gauge`, the `claude watch` keep-alive and the spawn gate file each
Claude probe, and the keep-alive fires its pass at once. Each fires ONCE per fault, held past the owner's Done until a
probe re-tests it. A Claude plans register that does not read is ONE card of its own, since every spawn fails
closed on it, and leaves each plan's card standing ([codex-plan-signed-out](reference/codex-plan-signed-out.md), [claude-plan-unusable](reference/claude-plan-unusable.md)).

## `secret-absent`: a credential nobody set, beside ones that are

A live settable register row absent from `$SLOPWEAVER_HOME/secrets/` while another live row on its exact platform
(or one it declares in `absentMattersWith`) is stored. One card per file (`perSubject`), `work` context, no float,
`slopweaver secrets set <name>` on the owner's pasteboard. Names only, never a value; an unlistable store is `unmeasurable`
([secret-absent](reference/secret-absent.md)).

## `resync-signed-out`: a scheduled resync stopped at a sign-in page

If the fleet needs the owner to sign in, a button goes in front of the owner. A resync attempt whose
page walk read a platform's sign-in page records that origin and gives its slot back; the monitor posts ONE card per
origin, `work` and `floats`, naming the host and the owner's work Chrome, the Chrome pin opening that origin on the owner's
pasteboard, and the seat re-seats the row once that card is settled. A non-sign-in failure raises none, and the fleet-health line says what the fleet is doing about it instead
([resync-signed-out](reference/resync-signed-out.md)).

## `publication-leak`: something already published carries what the privacy check refuses

`slopweaver audit publications` reads back what the fleet published on GitHub, Slack, Linear and Notion, daily
through `publication-audit-daily`; each finding is ONE floating card, `work`, naming the class, the door and the link,
never the term. A partial run settles nothing ([publication-leak](reference/publication-leak.md)).

## `codex-fleet-capped`: every Codex account out, told the pass it is read

Four accounts once sat capped three days behind rule 9's fallback, so the fleet lets the owner know. The fleet read files what it ranked (the store's `codex_fleet_cap` row); when no account can take a
pass and one or more is at capacity, a NOTICE floats naming each account's reset — never a purchase, never a queue
card, since the owner waits for the reset. It lapses at the first reset ([codex-fleet-capped](reference/codex-fleet-capped.md)).

## `fleet-unhealthy`: the whole fleet failing, as one note on the owner's screen

Syncs failing fleet-wide and the bot unhealthy are escalated to the owner. A day
of scheduled runs failing past a quarter, two dying mid-run, or the bot off Slack floats ONE note leading with
what CHANGED since the last one, every failing row behind its Details row, over any note already up. A pass
with nothing new, outside 07:00–22:00 Melbourne, or inside the spacing (30 min for bad news, 2h for good) is
HELD: nothing posts, even after the owner's Done. The chair fires it every tick, and `tick close` refuses a
tripped verdict with no note up unless held ([fleet-unhealthy](reference/fleet-unhealthy.md)).

## `org-health`: a page when an incident starts, nothing unasked otherwise

A floating note when an incident starts, reopens or changes severity, almost like paging the owner;
everything else is quiet. Healthy teams are never mentioned. `org-health read` snapshots the incident channel; the
monitor floats ONE notice keyed on the newest loud moment and posts each key once; `org-health status` tells the
rest on demand, the console's sidebar carries no indicator for it ([org-health](reference/org-health.md)).

## The filter: no cmux banner reaches the owner — the floating note is the one surface

Floating macOS notes replace cmux notifications, and they link the owner to something useful on a click. So the hook strips
`desktop` and `sound` from **every** notification, the pinned chair's included — the record, the unread
mark, the sidebar reorder and the pane flash all survive, so nothing is lost, it just stops interrupting. A
step only the owner's hands can take goes up as a `hand post` note, which carries the act and a link to its row; a
question goes on the console Queue through `handover ask`, never a note.

```bash
slopweaver monitor filter show      # the script that WOULD be written; touching nothing
slopweaver monitor filter install   # writes it, backs up whatever the hook path held
slopweaver monitor filter status    # what is on disk, and how many notifications it has judged
```

It **fails open** — no `jq`, or a payload it cannot parse, passes through untouched — because the worst case
of a hook error should be the noise that was already there, never a policy cmux cannot read.
Detail: [the cmux filter](reference/the-cmux-filter.md).

## What this lane does not do

**No daemon, no clock, and nothing resident.** `monitor check` is a pass that runs and exits. Something visible
has to run it — a seat's own turn, a supervisor turn, a `slopweaver automation` row — and **if nothing runs any pass,
no card arrives**, a stopped recipe's included — which is why the chair's `tick open` fires `fleet-unhealthy`. No external clock is shipped: the owner's ruling (no cron, no
launch agent) stands, and whether to revisit it is the owner's call. The first pass that runs sees every stopped row
at once.

**The delivery lane is macOS `osascript`, entirely outside cmux**, so the filter cannot suppress this lane's
own cards. The residue is the one the push lane already states: if banners are off for the script runner in
System Settings, nothing here can tell.
