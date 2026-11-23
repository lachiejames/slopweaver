# Exactly once — the slot ledger

A recipe must never double run and never be missed: it runs exactly once, and if it fails it is picked up again
and retried in a way that causes no further problem. The whole class is solved the way webhook idempotency is
solved, never as a patch on one symptom. The three symptoms: the owner and the fleet are missing messages; a post
went out twice; a run failed and never came back.

## The one idea

**A cadence firing is an EVENT, and an event has an id.** `slotAttemptKey = sha256([recipeId, slotIso])` —
derived, never minted, so every dispatcher on the machine computes the same id for the same firing with
nothing to agree about. `$SLOPWEAVER_HOME/live/recipe/slot-attempts/<key>.json` holds that firing's whole
story: who took it, under what lease, on which attempt, and how it ended. Everything below follows from that.

## The three acts, and their order is the guarantee

```
take  → run → settle
```

- **Take before the effect.** `beginSlotAttempt` holds one mutex across read-judge-write, so two dispatchers racing
  one firing are serialised and the loser reads the winner's row. The SEAT path is the same act in two halves — `automation
seat` opens the attempt, and the seated session's `startSeatedRun` stamps when the run began, also under the mutex, a
  compare-and-SET rather than a read, so two invocations of one seated command never both reach the effect.
- **A seat the schedule overtakes is carried forward.** A seat leases the firing it takes until the row's own next
  firing, and a session can arrive after that — MEASURED, a seat two minutes before the next firing of a `0 */4` row, its lease
  ending at that firing, the session ready a minute after; and a 21-row pass running past a firing. The token still holds an attempt
  nothing ran under (`runStartedAtIso` is null, and that stamp precedes the effect), so
  `seatedAdmission.ts#carrySeatForward` gives it back exactly as a seat whose session never opened is given back,
  takes the firing the row is due for NOW under the same holder and token (`findAttemptHeldBy` is the by-token
  scan), and starts it. A due firing another seat holds is refused by the ledger's own verdict, and the seated
  command exits non-zero naming that seat. No seat-side minimum lease exists — that would be the invented threshold
  the standing rules refuse, and the seat cannot take a firing that has not happened.
- **A seat whose live row is not due when its session reaches it gives its firing back** (`giveBackSeatNotDue`, same locked check):
  github and linear once read DEFERRED after a long slack run, sat open to their lease, and read as deaths.
- **Settle after it**, quoting the token the take minted. A run that finishes after its lease expired and a
  successor took the firing settles NOTHING.
- **The stamp is a CONSEQUENCE of settling**, never a separate act. `definition-runs.json`'s watermark moves
  if and only if the firing is retired.

## What each ending means

| the run                                             | the record says              | the watermark                  | what happens next                                     |
| --------------------------------------------------- | ---------------------------- | ------------------------------ | ----------------------------------------------------- |
| exit 0, or `EXIT_EXPECTED_EMPTY` (3)                | `succeeded`                  | moves past the firing          | nothing; the firing is done                           |
| `EXIT_DEFERRED` (4)                                 | `deferred`, carrying why     | does not move                  | the row is due again, at the SAME attempt number      |
| anything else                                       | `failed`, attempt _n_, why   | does not move                  | the row is **HELD** on one `recipe-failing-*` finding |
| abandoned, it ran, its holder is gone               | `dead`, `HOLDER_GONE`        | moves, so the schedule goes on | the row is **HELD** on one `recipe-failing-*` finding |
| abandoned, nothing settled, effect cannot be proved | `dead`, `OUTCOME_UNKNOWN`    | moves                          | the row is **HELD** on one `recipe-failing-*` finding |
| attempt 3 failed                                    | `dead`, `ATTEMPTS_EXHAUSTED` | moves                          | the row is **HELD** on one `recipe-failing-*` finding |

**A failure keeps the step's own WHY.** Every recipe step (a verb-run row's verb, a card's read and post,
`metrics-push`'s produce and submit, an `investigate` ask and brief, the hygiene landing read, the fleet-ceiling
card and its withdrawal) writes its reason to stderr, and `automation run-due` keeps each step's tail, a verb
child's included (`cli/commands/automation/runDueVerbProcess.ts`), ending a failed step's line, which IS the record's `detail` and the finding's ask, with `· why: <its last
three stderr lines>` (`live/automation/verbFailureWhy.ts`, `cli/commands/automation/collectLeg.ts`); only the
FAILED step's own stderr, never an earlier leg's progress. A firing retired dead keeps its cause on the run stamp
too (`failureCause` and its `failureSlotIso` in `definition-runs.json`, cleared by the next STAMPED run that is not itself dead; a deferral stamps nothing, so the stamp and its cause stand), so the Automations
page still folds it once the slot record is gone. MEASURED: `store-restore-rehearsal-monthly` failed with a detail of `… · exit 1` alone, a passing hand run overwrote the verb's own `last.json`, and the
cause was gone (`grep -h '"detail"' …/slot-attempts/*.json`). A verb doing more work after a failing step restates
it LAST: `refresh` ends on `refresh failed: …`.

**A failure pauses the row until its fix lands**: ONE p0 finding per broken row, never one
per retry ([the failure hold](holds.md#a-failure-hold--placed-by-the-store-lifted-by-the-fix)). **Once the hold
lifts, the retry schedule is the CADENCE.** There is no second clock. A failed firing does not advance the
watermark, so `definitionDue.ts` judges the row due for it again; at the row's own next firing the cadence
abandons it. Retries live inside a firing's own period, which keeps `onMissed` true for a machine off for days.

The only thing the record adds to the schedule is a FLOOR: attempt _n_ of 3 waits `period / 2^(3 - n)`, so
`period/4` then `period/2`, and 1/4 + 1/2 < 1.

**A deferral is RECORDED, not erased.** The row carries a `deferred` outcome with the verb's own reason on
it, `judgeSlotAttempt` reads that as `open` at the same attempt number, and `live/automation/silentRows.ts`
reports it where the owner reads. An erased deferral leaves no trace but the tick's stdout: MEASURED,
`vulnfix-digest-acme-admin` deferred every slot for two days on a top-up generation whose session had
died, and `definition-runs.json` went on reading `exitCode: 0` from the last firing that did run — so "has
posted nothing for two days" and "posted fine" were the same bytes to every reader downstream.

**A verb that returns 1 for a not-yet holds its row on a finding for nothing.** A daily row reading an atlas
kind whose freshness window is shorter than its cadence meets a stale input on most firings; a verb that
answers that with `EXIT_ERROR` exhausts its attempts and the post goes silently missing. The line is in the
verb, not the schedule: a staleness refusal maps to `EXIT_DEFERRED` and every other read failure to
`EXIT_ERROR`, drawn by the atlas's OWN freshness verdict rather than by which sentence sounds recoverable.
**Check a row's input freshness window against its cadence before scheduling it** — a window shorter than the
cadence cannot be kept, and every firing will meet a stale input.

## The one honest concession: an abandoned attempt whose effect cannot be proved

An attempt is ABANDONED when its lease expired with nothing settled, or — sooner — when the process running
it is gone. `automation run-due` performs its effect itself, so it records its own pid as `holderPid`, and
the next take probes it under the ledger lock (`live/automation/holderLiveness.ts`): only ESRCH reads dead, and
a reused pid reads alive, so both fail toward HELD. A seat or a claim records none — its CLI exits before the
session runs — but the seated `run-due` stamps its OWN pid in the same write that marks the run started
(`startSeatedRun`), so only a seat whose session never started, and a row written before the field, stay
lease-only. MEASURED: a seated `resync-corpus-slack` run died of a heap-OOM abort (exit 134, no
handler can catch it) with `holderPid: null`, and read HELD for about three hours, until its lease ran out. MEASURED:
a `store-backup-daily` run-due killed by its caller's `timeout 1700` read HELD to every later tick for the
rest of its cadence period; with its pid recorded it dies `HOLDER_GONE`, `holder pid N is gone`, on the next
tick, and holds the row. The next day the chair's own tick killed another slot the same way under `timeout 900`. So
**never put `automation run-due` under a deadline**: the `run-due-deadline` PreToolUse hook
(`src/admit/runDueDeadline.ts`) refuses a non-dry run-due beneath `timeout`/`gtimeout`, in a foreground `Bash`
call, or in a background one below `timeout: 7200000` (omitted, the tool kills it at 30 minutes; hatch
`SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE=1`, only when losing the firing is the point, as in a throwaway-home test), and a
catchable `SIGHUP`/`SIGINT`/`SIGTERM` that reaches one anyway kills the firing on the spot as `KILLED_BY_SIGNAL`, naming the signal — or, read only once the effect has resolved (a
`spawnSync` child finished), leaves the real outcome settled and exits `128 + n` saying so. A second signal while a
retirement or settlement still writes exits at once and never writes twice. `SIGKILL`, power loss and a failed
ledger write still fall back to holder liveness. The row's verb runs in a child with no listener, so a signal ends it even mid synchronous call; it carries `SLOPWEAVER_RUN_DUE_VERB_CHILD` (run-due's pid, so a nested run-due keeps its own child in the outer group) and `SLOPWEAVER_CALLER_GATE_HOMES` (the tick's ruling-gate homes).

**A death lands only on the attempt that was judged.** `retireSlot` is a compare-and-set under the same lock:
the stored row must still carry the verdict's attempt number and token, unsettled or `failed`, or nothing is
written, stamped or registered and the tick says another dispatcher changed it first. The verdict was read
under a lock since released, and a retake in between is a live attempt a stale death would kill. A retirement
the ledger could not perform at all stamps and registers nothing either; the next tick judges it again.

Either way the effect MAY have landed, and what happens is decided by what it can prove — three answers, and
**an attempt that RAN (`runStartedAtIso` or `holderPid` set) is never retaken**: past the keyless check it dies
`HOLDER_GONE` and holds the row, since a verb that died mid-run is what a hold exists for. The two retries are
for an attempt that never started:

- the run only READS (`resync`) → retry freely;
- the run writes through something that takes the firing's own key (`alert-summary`,
  `datadog-alert-digest`, `investigate`, all of which reach `slack post --idempotency-key`) → retry, because
  the door refuses the second delivery;
- the run writes through a destination with no key (`verb-run`, whose argv is arbitrary by design) → **do
  not retry.** The firing is declared dead and the row is held on its finding. A visible finding is not a
  missing message in the owner's sense — the owner is told — while silently re-running a verb that may already
  have written is the double the owner named.

## The delivery half — `slack post --idempotency-key`

The scheduler cannot close the window between a post landing and its receipt being written; only the
destination can. So the firing's key rides into the send, `duplicateKey` uses it INSTEAD of the message
content, and a second delivery under the same key is a door **HOLD** rather than a warn.

Content-keyed would not work: an alert-summary re-reads its channel before composing, so a re-run of one
firing carries words that have moved on and a content hash that no longer matches.

**The keyed hold carries no override, deliberately.** Nobody is watching a scheduled send, so an override
would admit the second post it refuses. The refusal says so and names the failure hold instead.

## Reading it

```bash
slopweaver automation due            # a held row names its holder and its lease, off the ledger
```

No verb edits the ledger by hand, and none should: every write is a take or a settle by a dispatcher that ran.

## A seat steps past a firing the ledger will refuse

`automation seat` reads this ledger while it plans, and a firing it will not hand over is **stepped past, not
seated**: the next due row fills the place, and the skipped one prints the ledger's own words plus `skipped, not
seated` — as does a resync walled at a sign-in page, **AWAITING SIGN-IN** ([why](../../monitor/reference/resync-signed-out.md)).

Three verdicts reach that path, the refusing ones an ACTIONABLE row can carry — **COOLING** (a failed attempt
whose hold lifted but whose retry floor is ahead, printed with WHEN it failed and what it recorded, since the
line is read hours later and once was taken for a fresh failure), **EXHAUSTED** (every attempt is spent) and
**settled** (a firing already finished with, which a retired slot can be while its row reads due). `held` and
`abandoned` cannot: both leave the outcome `null`, so `openAttempts` reports the row held — except an attempt
whose `holderPid` is gone, which `run-due` can retire and the seat judges the same way. A row the store HELD is
not actionable, and one held between plan and claim is skipped at the claim (`rowHeldNow`).

**`--dry-run` reads the same ledger**, ahead of the fork, so it plans and prints exactly what the real seat
would claim rather than a promise it could not keep.

MEASURED, with a seat claiming the whole prefix unread: one refused firing at the
front released every claim it had taken and opened no session. Three `--limit 10` seats in one hour went that
way while 25 due rows behind them went unserved for over three hours, and `--dry-run` promised ten rows each
time. `resync-atlas-cloudflare` was on attempt 2 of the 3 a slot gets, which is why EXHAUSTED is stepped past
too.

## A `metrics-push` firing stamps ONE UTC day, so a hole walks one tick at a time

Its produce leg runs the producer the profile declares (`datadog produce`, [metrics push](metrics-push.md))
before `datadog submit --allow-late` stamps a single UTC day. That is the delivery guarantee doing its job —
one firing covers one day and no more — but it means a gap of several days closes one tick at a time. One
`datadog produce --day` and one `datadog submit` per day fill the hole by hand when waiting is not worth it.

## What would mean this is not built

- Two ticks both report `· ran ·` for one row at one firing.
- A row whose verb exited non-zero reads `current` on the next breath.
- A card goes out twice for one firing, with different words each time.
- A firing fails and nothing appears on the board, or the row fires again before its finding is settled.

## Known residue, named rather than discovered

- **The ledger is not pruned.** One file per firing per row, forever. `findOpenSlotAttempt` scans it on the
  release path, so that scan's cost grows with the number of firings this install has ever had. A pruning
  rule needs a decision about when a settled firing stops being worth keeping, and nobody has made one.
- **`definition-claims.json` is dead state.** No module or verb reads it, and nothing removes it, so an
  install that holds one keeps a stale file.
- **A lease is never renewed mid-run**, because a renewal needs a heartbeat and a heartbeat needs a resident
  process, which `AGENTS.md` rule 2 bans. So a run that STARTED and then ran longer than its row's own cadence
  period still loses its lease; only an attempt that never started is carried forward. A successor's take is
  VISIBLE on the record, rather than the first run's stamp being silently refused and its work lost.
