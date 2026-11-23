# Anomalous load dispatches an investigation by itself

The gap this closes, in one sentence: **a reading nobody is obliged to act on is not a mechanism.**

**MEASURED.** `machine capacity` published a `capacity-hold` naming a stalled hook and nothing consumed it. The
owner found the rest by hand: load **45.9**, one seat's `bfs` walking `/` at **three cores**, five stale `nx`
daemons owned by nothing the fleet launched, and three parked seats. The fleet was not blind — the tick READS
capacity every sweep, and eleven consecutive ticks had already published `HOLD on cpu (1-min load 146, hold at 22)`
while naming nobody ([fleet-attribution.md](fleet-attribution.md)). A louder reading would have changed nothing,
so the fix is structural: make it impossible to miss again.

Three pieces, and each is a mechanism rather than a rule an agent may skip.

## 1 · `machine watch` — the between-tick watcher

```bash
slopweaver machine watch --once                  # one sample; the default shape
slopweaver machine watch --for-seconds 600 --interval-seconds 60   # bounded FOREGROUND loop
```

Exit **1 means a dispatch was written** — a finding, not a broken tool — and **0 means every sample read
clear**.

**Four triggers**, and each number is a first measurement to ratchet, never a line to argue past:

| Trigger            | Fires on                                                                                        | A measured reading                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `hold`             | whatever `machine capacity` already held on                                                     | a hold nobody acted on                                     |
| `single-process`   | one process ≥ **3 cores**, sustained **120 s**                                                  | heaviest single process 89.0% — well under one core        |
| `process-count`    | one session tree over **40 NON-HOOK** processes                                                 | largest non-hook tree 24                                   |
| `daemon-footprint` | a foreign WATCHED daemon (`fseventsd`) over **1 GB**, on exact bytes — a fresh one reads 4.5 MB | `fseventsd` at 24 GB — an ALERT for days, dispatched never |

**A watched daemon is read by pid and named first.** `src/live/machine/daemonWatch.ts` lists each daemon by its exact `/System` binary path, and
`top` reads them by pid BESIDE the top-15 ranked list, so one ranked sixteenth still fires. When one stands it
is the subject and signs `daemon-footprint|<label>|foreign` whatever else fired, because it lasts for days
while a hog or the hold beside it flips, and a signature carrying those would reopen the backoff on every flip.
Its relief (`sudo killall fseventsd`) is ROOT, so it rides in `why` as the owner's one hand step, never as `kill`. The
seat it opens is itself a worktree, some 175k paths of churn, which is the trade for naming the slow client
while it is still slow.

**Why NON-HOOK, and why there is no total-fleet count.** `hooks/hooks.json` hands a `Bash` call to ONE PreToolUse
row, two node processes per firing, against a mandatory detective fan-out whose
measured lap ran 28 readers — about **56 hook processes under one session on completely correct work** (after
ten entries were folded into one). A line over the raw process count would still fire every bot
turn. A total-fleet count would scale with a fleet the owner wants maxed, so it
could only ever punish success.

**The elapsed qualifier is not belt-and-braces.** The sample is `top -l 2 -s 1`, a ONE-SECOND window, so a
compile burst genuinely reads 300% for one sample and is gone before a seat could open.

**Doctrine rule 2 holds, and is built rather than promised.** This process launches no model: it opens a cmux
workspace the owner sees and can interrupt. `--for-seconds` is capped HARD at **900s**, below the sweep
cadence, so a watch never STARTS a sample past the tick that started it (a sample that seats still runs its
spawn to the end). **There is no `--detach`** — no flag, no plist, no fork; a chair running it as a
background task of its own visible session is still that session's process, not a daemon.

## 2 · The register — an obligation, not a log line

Every anomalous reading writes a row to `$SLOPWEAVER_HOME/live/machine/dispatches.jsonl`, carrying the
triggers, the culprit, **the culprit's process tree**, and either the seat it opened or the reason in words
that it opened none.

```bash
slopweaver machine dispatches                    # the open rows and their trees; exit 3 when there are none
slopweaver machine dispatches --all --json
slopweaver machine dispatches settle <id> --witness "<what you actually found>"
```

`settle` is the ONLY way a row stops being open. `--witness` is mandatory and is a free-text observation,
because a settlement with no witness is exactly the silent close this register exists to prevent. A
settlement is an APPEND of the same id, never an edit, so a reader can never catch the file mid-rewrite —
this register's whole job is to be readable at the moment the machine is least healthy.

Rows carry LABELS from `comm`, never an argv: they reach the fleet briefing, and an argv can carry a token in
a flag value.

## 3 · The gate — `tick-record` refuses an undispatched hold

`tick-record` REFUSES a tick when **all three** hold:

1. the tick's capacity reading was taken and says the machine WAS holding — on more than recent boots, a
   pause that clears itself and whose investigation would be one more boot, or the disk floor, which
   `worktree prune --apply` clears and an investigation would not. A hold on `boots` or `disk` alone opens no
   dispatch row, seats nothing and needs no `hold-rationale` (`NOT_STANDING`,
   `src/live/machine/capacityVerdict.ts`). Not mechanised: no conjunct asks a tick that read a disk hold for
   a witnessed prune run, so [sweep-contract.md](sweep-contract.md) step 8 is the rule there;
2. that reading carried no dispatch row COVERING it — an open row that SEATED a visible session
   (`machine capacity --json` reads the register itself, so this arrives on the tick's existing capture —
   there is no thirteenth source);
3. and the tick recorded no `hold-rationale` judgement whose subject is `{"kind":"machine"}`.

**The third conjunct is what stops the gate wedging the supervisor.** `machine watch` is bounded and
foreground, so it is usually not running between ticks; with only conjuncts 1 and 2 a real hold no watcher
happened to observe would refuse every tick with nothing the chair could do in band. So the way out is the
same **act-or-narrate** shape [sweep-contract.md](sweep-contract.md) step 14's other refusal uses:

- **ACT** — run `slopweaver machine watch --once`, and the gate is satisfied by evidence rather than by
  assertion: it writes a row if the anomaly is real and exits clean if it is not. **Only a SEATED row clears
  the gate**, so a watch reporting no seat — the backoff in force, or a failed `cmux spawn` — has written the
  row and answered nothing: narrate that reason, do not run it again.
- **A seat takes MINUTES, so never wrap the watch in a short `timeout`.** A clear reading is seconds; a seat
  runs `cmux spawn`, which boots the workspace before it returns. MEASURED at load 27:
  `timeout 90 … machine watch --once` killed the watch mid-spawn after its board row was registered. Run it
  with no timeout or as a background task. The row is recorded `registered` BEFORE the spawn, so a killed
  watch still leaves the dispatch id its board row cites — `machine dispatches` prints the recovery for it (from a
  checkout that has the `registered` arm; an older one cannot see the row at all).
  A `registered` row does NOT clear the gate (a spawn nobody confirmed covers nothing), so a tick that could
  not wait for the seat narrates a `hold-rationale` naming the slug, and the next watch reads it. A
  `registered` row holds its signature live for 900s only and is never promoted to `seated`, so after a
  hand re-spawn a later watch may seat that signature again, limited only by the backoff.
- **NARRATE** — record a `hold-rationale` judgement on the `machine` subject saying why this tick leaves the
  hold alone. Holding off because the load is heavy right now is a
  legitimate call **when it is said out loud**.

The hatch is `SLOPWEAVER_ALLOW_UNDISPATCHED_LOAD=1`. A capacity observation that is not `read`/`partial`, or
one carrying no `hold`, refuses as `unreadable` rather than passing: a check that reports clean on an input it
never saw is worse than no check.

## The backoff gates the SEAT, never the ROW

The backoff is exponential, for fleet load balancing. **300 s**, doubling on each consecutive
unsettled dispatch of one signature, capped at **5 doublings** (2h40m) so a signature can never become
permanently un-investigable.

**Suppressing the ROW would deadlock two mechanisms built in the same change**: anomaly fires → backoff
active → no row → `hold` still true → the gate refuses the tick → and the operator's one way out
(`machine watch --once`) is itself backed off and writes nothing. A row is one append to a JSONL file; it is
the evidence the gate reads, and the only thing that makes an unseated dispatch visible rather than silent.

**An already-running investigation is not a backoff case.** Doubling on a signature whose investigation is
still live would punish the fleet for working — the reason not to open a second seat there is a liveness
fact, not a rate limit. So liveness is checked FIRST, and the row says which of the two reasons applied.

**Two resets, and only two**: a settled row on that signature **that named something to remove**, or a clear
reading of it (the culprit is gone, so nothing asks about that signature again and the window lapses).

**Settling a MACHINE-subject row resets nothing**, because answering one cannot clear it — it blames nobody
and carries no `kill`, so no act available to the settler touches the condition. Measured:
`hold|hold on cpu|foreign` stood at nine consecutive dispatches and its 9600s cap, and injecting the
settlement its seated investigation was about to write returned `{consecutive: 0, maySeat: true,
windowSeconds: 300}` — one fresh seat per sample, on a machine holding at 2.8 of 12.0 busy cores' worth of
fleet. The row is still written, still refuses the tick until somebody narrates, and is still seatable once
the cap elapses; only the seat is rate-limited. `slopweaver machine dispatches --all --json` re-reads it.

**The signature never contains a pid** — it is the trigger kinds, the culprit's label, and the owning session
or the literal `foreign`. A restarted `nx` daemon gets a fresh pid every time, so a pid-keyed signature makes
every recurrence look novel and defeats the backoff outright.

## A bare HOLD names the MACHINE unless the blame is rank-independent

**A session id behaves exactly like a pid when the hold is machine-wide.** `fleetCulprit` falls through to the
top of a CPU-sorted list, so on a FLAT list the subject is whichever session the one-second sample caught.
Measured: four readings in twenty-seven minutes named four different sessions, each 5.4–7.3% of a
fifteen-core machine and each carrying its own `kill`, while all twenty-four live sessions together were 2.8
cores against a 1-minute load of 24–36 — a disk queue, not the fleet. The load fell 36 → 24 with nothing
killed, and two rows **77 seconds apart both attempted a seat** because the 300 s window is keyed on a subject
that had rotated under it.

So a bare `hold` names a culprit SESSION only on one of two marks, both already in the reading:

- **a stalled hook** — `hookStallSeconds` at or over the report's own `hookStallHoldSeconds`;
- **a STRICT majority of the MACHINE's busy CPU** — the session's `%CPU` over everything else `top`'s header
  says the machine is burning (`hiddenCpu.busyCores` × 100, less the session). An unread `busyCores` names
  nobody.

Everything else is the machine: label `hold on <subjects>`, **no `kill` at all**, and a signature identical on
every reading, so the backoff engages. An ORPHAN group is untouched — `slopweaver machine reap` costs no
workstream and a dead seat's snapshot name does not rotate.

The majority test is a relation inside one reading rather than a threshold, so it needs no re-measurement on
another machine. It is of the MACHINE because a session that is not most of what the machine burns cannot be
what holds a machine-wide load. Measured: the old majority of the FLEET's own
CPU named a ten-hour seat with `kill 73794` at load 48.85, off 97% — 92.5% of it one 16-second-old `node` —
on a machine reading 15 cores busy, 8.4 of them unattributed; load fell to 31.8 with nothing killed. Either
relation picks at most one session within a reading; neither stops the subject rotating across readings. A
lone two-and-a-half-core tree on a fifteen-busy-core machine is the machine subject, carrying that tree — the
single-process and process-count triggers name the concrete thing to end. `src/live/machine/anomaly.ts`
carries the rest, and the reason the machine row composes its own `why` instead of quoting `report.verdict`,
which ends in `capacity`'s own `SUBJECT … end it with kill <pid>` clause.

## OPEN is not COVERING, and the gate reads the second one

An open row means only that nobody has settled it. A row whose `seated` arm is `none` — a seat the backoff
suppressed, or a `cmux spawn` that FAILED — is an unanswered alert, the opposite of coverage. Counting one
as an answer made the case where the fleet tried to investigate and could not the case where the gate stopped
asking, and let an old row opened on `mds` silence a later hold on a seat's `bfs` (a review pass named
`gate-cannot-be-satisfied-by-assertion`). A gate armed there wedges nothing: the narrate escape is still
open, and "the seat is backed off until <UTC instant ending in Z>" is a sentence worth recording anyway.

## What `machine capacity --json` carries

`dispatch: { open, covering, subject, backoffSeconds }`, folded off the register by the same code `machine
watch` decides against — two folds over one file is how two readers of it end up disagreeing. The tick's
`CapacityFacts` carry all four, the GATE reads `dispatchCovering`, and the briefing's machine line says how
many findings are open and how many have a session on them.

**An unreadable register reports zero open, zero covering and no backoff**, deliberately: the gate then refuses the next
tick and the watcher is free to seat. Both are the safe way to be wrong. The opposite default — inventing an
open row nobody can see — would silence the gate on exactly the reading that most needs it.
