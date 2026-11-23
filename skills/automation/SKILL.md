---
name: automation
description: Read which automations are due, run the ones that are a command, and seat ONE visible session for the ones that are a session — the resync rows, which take minutes of provider walking, the daily hygiene-sweep row, which hands a session the landing packet for the owner's open pull requests, and the daily bump-fix row, which drives a repository's red dependency bumps green. Use when a supervisor pass is deciding what to do with a due row, when `slopweaver automation seat` has just opened this workspace on a board row naming claimed rows, or when someone asks what runs the scheduled resyncs now that no scheduler session stands by. Phrases like "what's due", "run the due automations", "seat the resyncs", "what runs the automations", and the old name, "scheduled asks".
argument-hint: "seat --limit <n> --model <name>, or the board row `automation seat` opened this session on"
---

# Automations — nothing stands by, a pass decides

An automation is a row in `$SLOPWEAVER_HOME/live/recipe/definitions`: a cadence, a kind this repository
ships, and that kind's parameters. There is **no clock**. The rule: no cron, no launch agent, no
headless model, nothing that spins up sessions the supervisor does not control. A row runs because a
supervisor pass read that it was due and judged it worth the cost, whatever the row is called (a recipe, a
scheduled ask). Except [`worktree-prune`](../../docs/worktree-prune/operations.md#two-triggers-and-neither-waits-for-a-supervisor-pass).

**And nothing stands by for the slow ones either.** The owner's ruling, on top of the owner's earlier doubt
that a standing session was needed at all: the resync rows are seated per pass, in a session that closes when
it is done, with no standing scheduler. `recipe` is an alias of the noun: [the alias](reference/the-old-name.md).

## Two shapes, and `automation due` is what tells them apart

```bash
slopweaver automation due            # read-only: no network, no model, nothing claimed, nothing written
```

Every row prints a line whether or not it is due (`--brief`, the tick's read, folds quiet ones into a count), and says which shape it is:

- **`run here, in this process`** — `verb-run`, `alert-summary`, `metrics-push`, `fleet-ceiling-report`
  ([the owner's DM](reference/the-owners-dm-not-a-channel.md)), a `datadog-alert-digest` row with no pictures, and `investigate`,
  printed `ask here, ANSWERED in the ask lane`. These are commands, none launches a model. `metrics-push` runs a producer the profile declares and stamps ONE UTC
  day per firing, so a hole walks one tick at a time ([metrics push](reference/metrics-push.md),
  [exactly once](reference/exactly-once.md)).
- **`SPAWN a session`** — `resync`, `hygiene-sweep` (below), `bump-fix` ([its order](reference/bump-fix.md)),
  `error-tracking-batch`, `thread-chase` ([its order](reference/thread-chase.md)), `owed-reply`
  ([its order](reference/owed-reply.md)), `inbox-triage` ([its order](reference/inbox-triage.md)), `linear-briefing`
  ([its order](reference/linear-briefing.md)), `alignment-briefing` ([its order](reference/alignment-briefing.md))
  and a `datadog-alert-digest` row carrying `shots`. A resync is minutes of provider walking: 29, 42 and 98 minutes
  for the worst single targets, 2h40m for one pass over about forty, holding the fleet's one coordinating session in
  the chair. Shots are taken in THE OWNER'S OWN CHROME, no tick drives a browser unattended (rule 2); the rest is judgement.

The shape is read from the ROW, not its kind — move a digest row to seated by editing its definition file, and
`automation due` prints the answer per row, so never infer it. An `alert-summary` row also READS Datadog:
[behind the alert](reference/behind-the-alert.md). A due, unheld, runnable row reads `actionable`; a claimed one
names its holder and expiry; an unparseable cadence can never be claimed, and says so. An OFF row says which
kind. `OFF · disabled` flips only through `automation enable|disable <id> --anchor <a> --words "<exact>" --why "<why>"`,
never a hand edit; `OFF · HELD` **outranks `enabled`**, no hatch; one held on a failure prints FIRST as `BROKEN` ([holds](reference/holds.md)).

## Where a firing's output goes: the owner's DM, and THE OWNER shares it

An unasked post is spam, as five screenshots of scheduled cards in team channels showed: the bot posts to the
owner's DM and the owner shares into a public channel when they choose. If someone asked the bot to do
something, that is a different story. **A clock is not an asker**, so every kind's card lands in `slackBot.promptChannel` and a channel value is REFUSED — planner and door both, neither with a
hatch — unless the row records the owner's own approval for it in `channelApprovals`. A person's direct ask is
untouched: it carries no slot key. An `investigate` row's PROMPT goes there too.
[The owner's DM, not a channel](reference/the-owners-dm-not-a-channel.md) · [private prompts](reference/private-prompts.md).

## Seating one, as the supervisor

```bash
slopweaver automation seat --limit 6 --model sonnet          # the prefix of the ranking
slopweaver automation seat --recipe growth-ops --limit 1 --model opus   # ONE named row
```

It claims every row it hands over, registers a board row carrying each token, opens ONE workspace on it, and exits.
Exit 3 means nothing needed a session — a status, not a fault. A firing the ledger refuses is stepped past
rather than refusing the whole seat — [exactly once](reference/exactly-once.md) is where that is written down.

Four things about it are the contract:

- **`--limit` is required and has no default.** How many rows one session should take is the seating
  session's judgement — the same judgement it has for board rows, with no heuristic.
- **`--model` is required**, per `AGENTS.md` rule 5. Every spawn names its model.
- **A spawn that fails CANCELS the seat's row, then releases every claim it took** — exit 4 included. A claim
  held for a session that never opened would silence its row until the next firing; a row left `ready` carries a
  token the ledger no longer holds, so spawning it boots a session `run-due` refuses. A row that
  cannot be cancelled keeps its claims, so its token stays live.
- **`--recipe` seats ONE named row**, because `--limit` is a prefix of the ranking and cannot reach a row
  sitting behind forty resyncs. Seat only one row that drives the owner's Chrome at a time: MEASURED:
  two browser-walk seats contended for the owner's one browser and every navigation read `ETIMEDOUT`.

Hold a due row when the fleet is full, narrated by name and lateness, **as a `hold-rationale` on
`{"kind":"recipe","id":"<id>"}`**: its one plain-sentence `claim` is what the page shows as why it stopped.

## The seated session

You were opened by `automation seat` on a board row that names each row you hold and the exact command for it.

```bash
slopweaver automation run-due --recipe <id> --claim-id <token>
```

One row at a time, in the order the row lists them, each a BACKGROUND call never under `timeout`/`gtimeout`, submitted with the Bash tool's `timeout: 7200000` — omitted, it kills the run at 30 minutes (a hook refuses all three). Each command TAKES that firing, runs the row's own verb,
and SETTLES the firing, stamping the slot only once it is finished with ([exactly once](reference/exactly-once.md)).
**A failure HOLDS the row** on ONE p0 `recipe-failing-*` finding the store files, with its `repo:` so the chair must seat it — never your own — until it is settled
`answered`, or `filed` as a `done` row ([the failure hold](reference/holds.md#a-failure-hold--placed-by-the-store-lifted-by-the-fix)); one that never reached the board is OWED, and every `run-due` retries it and fails until it lands.
**The token is the only way a spawn-shaped row runs at all** — without it `run-due` reports `SEAT IT` and runs nothing,
and a token that is not the row's live claim is refused rather than run. **A seat the schedule overtook is carried
forward, not lost**: a firing your seat took whose lease passed before you started it — a seat minutes before the next firing, or a long pass, both MEASURED — is given back and the firing the row is due for NOW runs under your token,
unless another seat already holds it: then the line names that seat and the exit is non-zero. **A row not due by the time you reach it** — DEFERRED to its successor, or already current — prints `seat given back` and exits 0: never left open to its lease.

### A digest row that carries pictures

The three daily alert digests post cropped, annotated Datadog images. Such a row is SEATED rather than run in the tick — the captures are taken in the owner's own Chrome — and the
run is two `run-due` commands with your own capture work between them. The dry run prints the shot list; a
capture that refuses is an image the card does WITHOUT, never a card held; and only a capture that passed its
readback may be attached. Procedure and worked numbers: [shots](reference/shots.md); an organisation-intelligence
post, since a tracker link is no evidence: [organisation intelligence](reference/organisation-intelligence.md);
one team-channel `finding` per issue, never a DM: [daily organisation hunt](reference/organisation-hunt.md), [error-tracking batch](reference/error-tracking-batch.md); a `vanta` resync's changes, judged: [Vanta changes](reference/vanta-changes.md).

Then, before you end:

- **Inspect a failed target.** One that cannot succeed unattended — a dead browser session, a token only the owner
  can mint — becomes a board finding with the exact steps:
  `slopweaver handover register --ask "…" --finding --evidence "…"`.
  **Never card the owner a question about whether to resync**: that is the rule this lane exists for. Any
  failed firing: `slopweaver automation explain <recipeId> --slot <iso> --attempt <n> --why "<what broke, so what fixes it.>"`,
  the slot and attempt your `run-due` printed, which leads the owner's row, raw folded; a quote, bracket, path or code is
  refused. One NO session watched, the next visible one to pick its card up explains: `automation repair` prints it.
- **Say what you could not prove.** A zero exit is necessary and not sufficient — `automation resync` records a
  postcondition per target; an atlas succeeds only when its generation clock MOVED, and a corpus success
  ENDS in propagation — a fresh landing reading and ONE visible pass ([corpus propagation](reference/corpus-propagation.md)).
  An Aether _NOTHING TO DO_ (exit 3) is nobody having asked, not a skip ([demand-gated](reference/demand-gated-resync.md)).
- **Close your own workspace.** A pile of idle seats is the standing session this lane refuses, by another name.

### A hygiene-sweep row

Seated daily by name (`--recipe hygiene-sweep --limit 1`). Its `run-due` publishes and prints the landing packet for the owner's
open pull requests, drafts included ([hygiene documents](reference/hygiene-documents.md)). **Act only where the act is
already authorised** — undraft, rebase, fix a red leg, land a green one by rule 1 — on THE OWNER'S pull requests, each through
its own verb. **An unasked Slack send, pull-request close or Linear close is a card** with its draft and evidence
(`handover register --ask … --finding --evidence …`), never an act: a packet row proposing one is not the owner's word.
**Then [re-verify up to five Queue cards](reference/queue-recheck.md)** against later evidence. End by saying what
moved, who each waiting row waits on, and which card holds the rest.

## Registering the rows

```bash
slopweaver automation register-resyncs             # reconcile the store against the roster this build derives
slopweaver automation register-standing --dry-run  # the rows this install REQUIRES, and which are absent
slopweaver automation register-standing --repo <owner/name>
```

A team repository's rows are a registration in `$SLOPWEAVER_HOME`, never compiled in
([team repository rows](reference/team-repository-rows.md)). **A declared row that does not belong on THIS install
is RETIRED, never deleted or held**: `automation retire <id> --anchor <owner-words anchor> --words "<exact quote>" --why
"<why>"` records it in `live/recipe/retirements.json`, removes the file, and `--undo` gives it back
([retired rows](reference/retired-rows.md)). A REPOSITORY DRIFT row is corrected by `automation repoint <id>`, never
removed ([own-repository rows](reference/own-repository-rows.md)).

`register-resyncs` runs at every decision point, never once at install: an atlas that lands in the repository
afterwards joins the schedule by being registered and by nothing else. It writes only
rows it owns, and reports a hand-written row, a paused row and a managed-looking row it did not write.

**Every managed row's kind is derived from its TARGET on every write** — `resync`, seated, or `verb-run`
run here for a compile-only atlas, which needs no model. No flag decides it, so a hand repair or a
reinstall is REPAIRED on the next pass. Read the count: [a kind a seat can reach](reference/a-kind-a-seat-can-reach.md).

## The posts a `verb-run` row sends

An automation that POSTS is a `verb-run` row naming the verb that composes the message, so the shape lives
in typed code and the channel, the address and the cadence live in the row. The row passes its `argv` to the
verb verbatim, so a posting verb carries its own `--channel` and its own day-one intro.

## A scheduled post introduces itself on its first day, and tags nobody

A card row does it itself until one of its runs has succeeded, from its own `params.intro` or
from lines derived from its cadence; an `investigate` row says the same in its `lead`; a `verb-run` row's own
verb carries it. Every bound the card applies, and every packing rule an `investigate` row's `question` must
clear, is checked when the row is PLANNED: prose the post leg refuses is refused at every firing.
[First day](reference/first-day.md).

A card row may also RECOMMEND, never composed on a clock — and on the owner's later word the loop
CLOSES, a `team-alerts-actioned-<channel>` row raising the top one as a draft pull request the card links:
[recommendations](reference/recommendations.md). An `alert-summary` leads with its channel's
worst priority and its trend, and ranks by a derived matrix: [priority matrix](reference/priority-matrix.md).

## What tells you a row has quietly stopped running — and what tells you it is GONE

`automation due`, for all three — late, GONE, and a row no seat can REACH (per-row health and sync runs: `automation status`,
[Automations](../../site/content/console/automations.mdx)). **A row nothing will ever seat prints above every other
line**, tallied as `N STRANDED`, because every number on that tally reads healthy while it is true ([a kind a seat can reach](reference/a-kind-a-seat-can-reach.md)).

A LATE row prints how late it is against its cadence, and `$SLOPWEAVER_HOME/live/recipe/resync-state/<recipeId>.json`
adds each target's last attempt, last SUCCESS and any blocker; no gauge sits behind either, so both are READ at a
pass. A DELETED row is the case listing cannot
see, the definitions directory being the only register, so the rows this build REQUIRES are declared in code and an
absent one prints FIRST above every other line: [declared rows](reference/declared-rows.md). The owner's view of the same records is `automation freshness`, the stored-copy line inside a Slack panel: [source freshness](reference/source-freshness.md). A seat repairing a stop runs `automation repair <recipeId> --row <slug>`: the owner's card becomes a note naming the seat ([monitor](../monitor/SKILL.md)).

## What would mean this is not built

- A row that is due and spawn-shaped sits actionable for hours while passes go by — nothing is seating it.
- A seated session finishes and its rows are still claimed, or still due.
- `automation seat` reports success and no workspace opened — MEASURED, a board row with no `repo:`
  that `cmux spawn` refused. The checkout is resolved BEFORE anything is claimed
  (`live/checkout/checkoutForRepo.ts`); a board row nobody is working is the symptom.
- Two sessions run the same target at once, or one firing runs twice: the slot ledger is what prevents that
  ([exactly once](reference/exactly-once.md)), and a dispatcher that runs without taking a firing is the hole.
- A failed row fires again before its finding settles, files none, or files a second while the first stands.
- Anything runs a resync without a visible session — a background process, a detached model, a cron entry. There
  is no such path here, and adding one is the thing every ruling above refuses.
