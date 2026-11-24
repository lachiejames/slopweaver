# The ledger, the state doc, and the depth gauge

What `session record` is for, the state doc a successor supervisor boots from, and how the context-depth
gauge feeds respawn candidates into the briefing fold. The rules these serve — record what you learn, and
never respawn a session whose value IS its accumulated context — are in [SKILL.md](../SKILL.md).

## What `session watch`'s four signals mean

It folds cmux's hook events into one signal per session, most-urgent-first, from a cursor and fold it commits
together to the local store. `needs-input` is waiting on a person; `working` is mid-turn; **`idle` finished a
turn and went quiet**; **`silent` went quiet WITHOUT finishing one — the shape a wedged session takes.** It
never says what a session DECIDED and its report is windowed, so it is a pointer to a screen read, never a
complete list. An exit 1 is a refusal, never an empty fleet: the store unreachable (`slopweaver store status`),
another watch committed first (run it again), or a stored fold that will not decode, whose way out is
`session watch --reset-state --since <seq>`.

## What to record, and the state doc beside it

Two reasons to call it: **registering a session you did not spawn** — if `ListAgents` or `slopweaver cmux
list` shows a chat the ledger does not know about, its first `record` call is what registers it, and there is
no other discovery mechanism yet — and **logging a status or decision worth persisting**: a routing
rationale, a blocker, an answer the owner gave that another session should also know, a resume you just
performed.

**Also keep a state doc** — `handovers/supervisor-state-<date>.md`, amended in place, not rewritten fresh
each time: rulings in force, a live fleet table, open owner decisions with your lean, traps hit today,
anchored landings, and a "delegate, do not investigate" boot-block line. This is what a successor supervisor
boots from — a transcript is not durable across a restart, this file is. `session record` is per-session
memory; this doc is the whole-fleet picture.

**A question that is properly this chat's to answer — not a routed session's — goes through `slopweaver
handover ask`, never a plain message that can silently vanish** (one was lost outright this way). It writes
the question to the run's journal, a file, so it survives this chat dying mid-turn, and it belongs on the
console's Queue card — never as a DM. `slopweaver session close
<session-key>` marks one done by hand, for a session `cmux close` does not already close — and
`slopweaver session close-done` is the sweep that closes every done, idle workspace — the bot loop's own ask
workers and answer reviewers included, once their turn has ended — and every drifted ledger row, without
anyone remembering to (sweep-contract step 3).

## 6a. Read the gauge, and flag respawn candidates in the fold

`slopweaver session depth` folds each live session's newest transcript turn into a context depth, the model
that served it, and a verdict against a threshold (300k by default, `--threshold` to move it) — so §6's
judgement needs no screen read. The owner asked for this as mechanism rather than exhortation, so it
is a standing part of the sweep, run every tick.

- **Every tick, run it, and put respawn candidates in the briefing's collapsed fold** — never the react-now
  block unless one is genuinely blocking the owner. A candidate is a suggestion with a name and a number attached
  (`<title> — 595k deep, 3 phases left`), not a decision the owner has to make.
- **A worker respawns itself**, by the handover skill's own procedure
  ([reference/running-a-run.md](../../handover/reference/running-a-run.md) § At a phase boundary): amend,
  release, spawn the same slug, close. Send that instruction with `slopweaver cmux send` rather than closing
  a live session out from under it — a session mid-phase has uncommitted judgement you cannot see.
- **Standing sessions are in scope, not exempt, and they have TWO gauges.** Depth is one; which commit they
  are running (§1) is the other, and the second respawns them by itself, gated, so you neither decide the
  timing nor can create the two-sessions-on-one-doc failure by hand.
- **Never respawn a session whose value IS its accumulated context.** A live investigation forty turns into
  narrowing a hypothesis loses that in a handover note. The gauge reports; it never acts, and neither should
  you without reading what the session is in the middle of.

## Your OWN depth is enforced, not reported

The gauge above is advice about other sessions. About you it is a mechanism, because advice measurably did
not work: one supervisor read `respawn-candidate self` about itself six times
(from 305k through 482k), then stopped running the gauge and swept on for another 8h42m
and ~520 turns to 988,396 tokens. A pull gauge stops being pulled exactly when it matters. Reproduce the
curve on any transcript with
`jq -r 'select(.message.usage) | [.timestamp, (.message.usage | (.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0))] | @tsv' <transcript.jsonl>`.

- **500k warns, and nothing blocks.** The advisory fires for EVERY session past 500k and stops none of them. Under
  the shared 300K window nothing reaches it, and it is not the chair's hand-off line: that is the auto-compaction
  trial (§ Do not hand off early).
  Blocking risks undesirable outcomes here, and the issue is usually not blocking versus not blocking but that the
  agent has no awareness there is a problem. The 600k hard block, its allowlisted handoff path and
  its `session break-glass` grant are all gone — nothing is refused, so there is nothing to waive.
- **It reaches every session, which is the half that was pointed the wrong way.** MEASURED over
  822 transcripts touched in the window: the pinned supervisor the old guard covered was **11.2%** of all
  above-600k spend, and the sessions it never spoke to were the other **88.8%**.
- **The warned session is told NOT to act on it.** Watching depth and spend is the supervisor's job, since the supervisor is the one who looks at session depth
  and token spend. So the advisory states the depth, asks only that durable state stay
  current, and names `slopweaver session depth` as where the call is made.
- **It repeats on every `Bash` call while you are past the line**, deliberately: the gauge it replaces failed
  by being something a degraded session simply stopped consulting.
- **It fails OPEN, and every path exits 0.** A hook that can only ever ADD context cannot wedge a session.

## What `session depth` tells you

It is the one command for the handover decision, and it is model-weighted — Fable costs more than twice Opus
per token, so a token-only figure understates it about 2x. Each row carries the session's depth, its
lifetime turns and its model-weighted draw in **index units, never dollars** (the plans are flat-rate, so
nothing here is a bill; the ratios rank sessions against each other). Below the rows it prints the fleet's
model mix and the rate card's id and date.

**A row reads `review` past 600k, and never `respawn`.** MEASURED: a restart saves about $0.37
of notional spend per remaining turn at 800k against 150k and costs a pickup, so it repays only once more
than about a THIRD of the pickup's own turn count still lies ahead. Of the 62 sessions that crossed 600k, 41
were past that line and 21 were not — so an action-shaped verdict would be wrong about a third of the time,
on a fact no gauge can see and you can.

## What `session compaction` answers — and the one half of it that is not answerable

Compaction is lossy: how would a quality regression be NOTICED, and how would anyone know whether 300k or 400k or
600k performs best per dollar and per hour? `slopweaver session compaction` is that measurement. It folds every transcript in
the window and reports three things, every one of them off the records rather than estimated.

**Per hour is read, not modelled.** Each `compact_boundary` carries its own `durationMs`. MEASURED over
seven days (`slopweaver session compaction --days 7`, 746 transcripts): **378 compactions,
134.3s each at the median, 841 minutes — fourteen hours of wall clock the fleet spent summarising instead of
working.**

**Per dollar is in tokens and weighted index units, never dollars**, for `src/sessions/modelWeight.ts`'s
standing reasons. The same week drew 31.7B cache-read tokens across 148k turns.

**Quality is the dropped-re-read rate**, and it is sharper than a re-read count because
`preservedMessages.uuids` names exactly which records a summary threw away: **47.3% of 65,317 post-boundary
reads went back for something the summary had DROPPED.** That rate, compared against the last recorded
reading, is the signal — `--check` exits 3 on `regressed`, 4 on `unmeasurable`, 0 on `holding`, and it
answers `unmeasurable` rather than a comforting `holding` when either side holds under 20 boundaries.

**Context is judged beside quality, weekly, by a standing row.** The report also carries the boot floor (the
median FIRST call's context — every rule file, skill listing and tool schema a seat boots with) and the cache
read per call; MEASURED at 60.1k and 186k over 631 transcripts, so the floor alone was a third of
the week's 27.6B cache-read tokens. The verdict regresses when the floor grows past 10% or the per-call read
past 20% of the last reading, and names each class that moved. `context-cost-weekly` runs it every Monday at
05:00 with `--alert`, not `--check`: the recipe runner reads `--check`'s exit 3 as "nothing to do", so a
regression would have stamped as a quiet week, while `--alert` FAILS the row and `automation due` shows it.

**Retrospective pricing works DOWNWARD only, and the table says so rather than guessing.** A week that ran
300k never accumulated a 400k context, so replaying 400k over it reports a near-zero cost — not because 400k
is free but because the evidence is absent. Every candidate above the point the fleet actually compacts at
(267k) prints NOT PRICEABLE with its own base, and no trade is computed into one. What the priceable band
gives instead is the ratio, and the ratio is what transfers: 100k→150k buys 4.81M tokens per extra
compaction, 150k→200k buys 12.8M, 200k→250k buys 14.9M. Each step out buys steadily more per compaction it
saves. **To price a looser window, move it and compare two readings** — take one now with
`--record-reading <by>`, change the setting, take another a week later.

## The token pass — where the draw goes, and what a landed change costs

`slopweaver session spend` is the pass that finds the fifty-percent wins across the fleet. Over whole UTC days (today left out) it folds every session AND subagent transcript, splits
the model-weighted draw by seat kind, model and gate refusal, and divides it by the pull requests merged as the
token's own account (`author:@me`, in every declared checkout's repository unless `--repos` names them). Each
drain is a REPRICING — a family's own tokens on the fleet's default family over every seat but the chair (rule 5
row 1 settles the chair's model, so its draw shows by seat and is never priced), subagent turns on Sonnet 5, a
FORKED subagent's inherited context above a fresh one's (the lower-quartile opening) — so it names a saving and the
ruling that takes it, never a bare share. Boot floor, re-reads and the window stay `session compaction`'s.

**A fork re-reads its parent's whole conversation on every turn.** MEASURED: the median subagent over
one week opened on 47.3k tokens (852 transcripts, 2 over 100k); the five forks of one vulnerability-fix seat each opened
on 144.6k, and after 20 minutes (282 turns) the context above a fresh opening was about 2.7M of their 6.5M units,
the fork drain as priced. A leaf gets a written brief.

MEASURED over the same week (`--days 7`, 1,398 transcripts): **15.6M units per landed change**, 407 landed, and by
day 24.5–33.6M on Opus 5 against 8.3–13.7M on Opus 5.5 — the model move, not a fix of the pass's. Seats drew
69.6%, the chair 12.1%, subagents 10.2%, the bot 7.6%. Priced drains past the Opus 5 week: Opus subagents
1.9%, gate refusals 1.0%. A later seven-day window (`--days 7`) put the chair's Fable at 25.9%+3.6% of the draw and
non-chair Fable at 31 turns, so the chair is the whole Fable line and a model drain names a real outlier only.

`token-pass-weekly` runs it Mondays at 05:30 with `--finding`: ONE board finding row when units per landed
change moved 20% against the last reading or a drain worth 2% is new or has grown by half since it was posted,
and nothing on a quiet week — never a status. It exits 0 either way so the row stamps; a failed read exits 1.

`value-sample-weekly` runs at 07:00 the same Monday and asks what neither pass can: whether five of the week's
finished asks got used. It places one Queue card, and the owner answers one word per ask
([value](../../value/SKILL.md)).

## Do not hand off early — the shift-length curve, measured

**A hand-off has a fixed cost, so the chair hands off on its FIFTH auto-compaction, never on each one.** The
owner's ruling replaced the 500k hand-off: every model compacts at one shared 300K window, and the concern is that
a chair gets worse at its duties the more auto-compactions it goes through. Five is a starting guess, run as a
TRIAL whose settling measurement — correction rate per supervisory ACTION (defined below), bucketed by
auto-compactions so far — is named in `src/supervisor/chairAutoCompaction.ts`. The curve below argues against
rotating on every compaction; it says nothing about quality after repeated summaries, so it cannot derive five.

MEASURED over 200 supervisor shifts, from their own transcripts. A supervisory ACTION is an
outward move the seat exists to make — a `cmux send`, a spawn, a board write, a Slack or GitHub write, a
`SendMessage`. Cost is in plan-meter units, fitted against 31 intervals of the recovered `claude gauge`
series (R² 0.90).

| shift span      | shifts | median actions | meter units per ACTION |
| --------------- | ------ | -------------- | ---------------------- |
| under 60 min    | 87     | 12             | 7.20M                  |
| 60–120 min      | 55     | 42             | 2.45M                  |
| **120–180 min** | 31     | 60             | **2.19M** ← cheapest   |
| 180–300 min     | 20     | 86             | 2.26M                  |
| over 300 min    | 7      | 131            | 2.68M                  |

The curve is U-shaped for a reason that is itself measured: a shift costs **76M units before it supervises
anything**, plus 34M per supervised hour (least squares over twelve days, R² 0.87). That fixed cost is boot,
pickup and wrap-up — a sub-hour shift spends 174 calls to make 12 actions, a 2–3 hour shift 300 calls to make 60. Past five hours the curve turns back up as depth does, which is why the 500k/600k lines above stay.

**Peak depth is not the reason to go short.** Median peak by the same bands: 406k under an hour, 489k at
2–3 hours (p90 575k), 725k past five hours (p90 999k). A 2–3 hour shift lands inside the warn/block band by
design; only the five-hour shifts reach the wall.
Those peaks are on the model's default window; under the shared 300K one a chair compacts long before them.

What this cost, stated once so it is not re-derived: shifts per day went 5 to 48 while
landings stayed flat, supervisor API calls per day went 1,999 to 8,047 at a flat 563k–624k units per call,
and the Fable week went from 0.33 of a week per day to 1.02. Reproduce the meter with `slopweaver claude
gauge` and the per-shift figures with the transcript scan named in the § above.
