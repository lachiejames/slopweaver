# A free machine beside a ready doc or ask nobody is on cannot be recorded silently

The gap this closes, in one sentence: **a gate over OUTCOMES cannot see a ROW.**

**MEASURED.** A CPU panel read 89% idle, so the fleet was leaving idle cpu on the table instead of maxing capacity.
Six consecutive ticks spawned nothing at 1-minute load 4 to 10 against a `loadHold` of 22, while the reconciliation each one
read carried **13 p1 and 18 p2 groomed ready docs** with no seat on any of them. The sweep gate
([stated-outcomes.md](stated-outcomes.md)) passed all six, and correctly by its own predicate: an outcome with
ONE live seat is covered however many ready rows sit under it (one outcome: 9 live, 97 unspawned),
seven of the 31 rows sat under no outcome at all, and the two outcomes that were uncovered carried a
`hold-rationale` copied verbatim tick to tick. The headline the chair read counted only the top five.

```bash
jq -r '.ready[] | select(.kind == "doc" and .groomed and (.priority == "p1" or .priority == "p2")) | .priority' \
  ~/.slopweaver/readings/handover-reconcile/<instant>.json | sort | uniq -c   # 13 p1, 18 p2
```

The replay is `src/__tests__/unit/supervisor/idleCapacityReplay.test.ts`, over a draft and reconcile written
in the last of those ticks' shape under `src/__tests__/fixtures/supervisor/handoff-9291-tick-288/`: the sweep gate
returns clean, this gate refuses naming all 31 — judged over the fixture's doc rows, since its 361 p0–p2 asks read
`ready` only under that board, which had not yet moved an ask waiting on the owner to WAITING ON OWNER.

## The predicate — `src/supervisor/idleCapacityGate.ts`

`supervisor tick-record` refuses when ALL hold:

1. the tick's capacity reading says **no hold** — any hold, boots-only included, is clean here, unlike the
   load gate ([load-dispatch.md](load-dispatch.md)): that one asks whether there is an anomaly, this one
   whether a spawn was allowed;
2. the plan gauge does not read `nextAllModels: null` — that is Ceiling A **measured** (`claude gauge`,
   [fleet-capacity.md](fleet-capacity.md)). `nextFable: null`
   alone clears nothing, since a pinned Opus or Sonnet seat still routes; an unread gauge clears nothing either;
3. and `ready` carries a **groomed doc or ask at p0, p1 or p2** that no seat is on (`aligned`, `misaligned`,
   `unprioritised`), that no COMPLETED `spawned` action names as `{"kind":"handover","id":"<slug>"}`, and
   that no `hold-rationale` names with that same subject.

**Filling is owed only while a lane fills.** The owner's ruling is to fill capacity while the plans last and save
it on the last one, so once BOTH lanes are recorded lean or unavailable (`plans list`'s lane lines,
`src/plans/laneShape.ts` § `capacityObligation`) this gate refuses nothing. An unreadable register, or a lane
with no row, keeps it owed: a host can run on an ambient sign-in the register never recorded.

Tags, p3 rows and ungroomed docs are outside it: a row with no stated position is only ranked because it has to
be somewhere, the same rule `handover reconcile` applies before calling anything misaligned, and a tag with no
listener is a no-op by design (AGENTS.md rule 2). Every ask is groomed — it carries `askedIso`.

**Asks are owed exactly as docs are.** MEASURED during an audit of every open pull request of the owner's: 28
ready landing rows sat unseated, 25 with no run journal, while every tick passed —
the gate read only `kind == "doc"`, and every row `github landing --register` writes is a `kind: ask`
`--dispatch` row. That reconcile carried no groomed ready p0–p2 doc at all, so the gate owed nothing:

```bash
jq -c '[.ready[] | select(.groomed and (.priority != "p3")) | .kind] | group_by(.) | map({(.[0]): length}) | add' \
  ~/.slopweaver/readings/handover-reconcile/<instant>.json   # {"ask":435}
```

A `ready` ask is seat work by construction: one waiting on the owner's word with a whole problem, options and lean is
placed WAITING ON OWNER (`src/handover/registeredAsk.ts`). `--dispatch` persists no field, so `kind` is the
only thing a reconciliation row can be judged on, and a landing slug test would leave every other ready
dispatch ask invisible. Below a measured seat ceiling the board's rank — landing rows first within p1 —
decides which ones the free seats are owed to.

## With ceilings, every ceiling is the predicate, and a reason names one

Plan usage was being left on the table across Claude, Codex and machine resources. A capture whose `machine capacity --json` carried
`ceilings` (`src/capacity/ceilings.ts`) replaces conditions 1 and 2 with `admissionOf` (`src/capacity/admission.ts`): a held machine, or
every route through a plan measured spent, is clean; otherwise the tick had free capacity bound by the LOWEST
unused ceiling (`ceilings.lowest` — the machine, `claude:<alias>` or `codex:<alias>`). Plans are ROUTES, not a
conjunction: one spent plan never makes a tick clean while another routes. With no plan readable, the machine
alone admits, exactly as before.

The **Name it** way out then needs the PAIR: `subject` `{"kind":"handover","id":"<slug>"}` AND
`relatedSubjects: [{"kind":"ceiling","id":"<lowest>","label":"<why that ceiling does not take this row>"}]`.
A reason naming only the row, only the ceiling, or a ceiling that does not bind answers nothing; a spawn or a
seat still needs no ceiling. The refusal prints the whole reading and the binding id. A capture with no
`ceilings` key — every ledger row from before ceilings existed, and `idleCapacityReplay.test.ts` — judges exactly as
the three conditions above; a `ceilings` that does not parse is `unreadable`.

## With a measured N, the fill is owed to N and no further

Every pass fills to the measured ceiling. When the draft's capacity carries
`workingSeatCeiling: {"kind":"measured","seats":N}` ([fleet-ceiling.md](fleet-ceiling.md)), after admission
the gate counts the watch report's WORKING seats. **At N or above the tick is clean**, decided before the
reconciliation is read. Below it, the first **N − working** unseated ready rows, in board order, each need a
spawn naming the row or a `hold-rationale` on the row whose `relatedSubjects` carry
`{"kind":"ceiling","id":"machine"}`; rows past that deficit owe nothing.

**Only the machine answers below N.** N is the number the plans carry, so a Claude or Codex ceiling cannot be
what stopped the fill; a boot hold the start-of-tick capture could not see is, which is why the machine
rationale stands. A spawn of a lower row does not answer a higher one. A measured N with no watch rows is
`unreadable`; an unmeasurable N judges every ready row exactly as the sections above, and the refusal says the
ceiling was not measured.

## The three ways out, per row — and no wildcard

- **Spawn it**, and record the action's subject as `{"kind":"handover","id":"<slug>"}` with the workspace in
  its label. MEASURED over the last 300 ticks: 121 of 186 spawns were recorded as `{"kind":"session",
"id":"workspace:N"}`, which names no row; the refusal counts those and says to re-record them.
- **Take it off RUN NOW** — `slopweaver handover pause <slug> --on <who>`, or close it — and re-run
  `handover reconcile --json` into the tick's `--reconcile`. A row deferred tick after tick belongs here.
- **Name it**: a `hold-rationale` on `{"kind":"handover","id":"<slug>"}` saying why this tick left it. "I filled
  K seats this tick" is a legitimate reason for the rest.

**A seat waiting on the owner's steer is never what holds the slot.** "At cap" over open seats that are waiting on a
Queue question is the failure (every running seat must be on the highest priority): `session close-done` parks each at-rest one, and `slopweaver handover park <slug>` any it kept
([sweep step 3](sweep-contract.md)), then fill the freed slots from the rows above that have the owner's steer. A row
parked on the owner's question is WAITING ON OWNER and leaves `ready` until the owner answers, so it never asks to be spawned
twice; no waiting seat stays open (the owner's ruling).

**There is no all-rows subject.** A blanket rationale is exactly the copied every-tick text the incident was.
An outcome, `all-outcomes` or `machine` rationale answers its own gate, never a row here.

**A `role: supervisor` row is NAMED, never spawned** — a second chair is the duplicate-chair
incident. A superseded one already composes to `blocked` and leaves `ready`; a successor's doc written before
takeover can still appear.

**The reading predates the fill, on purpose.** The gate judges the decision against the reading it was made
on. Re-capturing `machine capacity --json` after a burst of spawns and re-drafting is legitimate: if the
machine now holds (recent boots included) the tick is clean.

## When it cannot see

A capacity reading not `read`/`partial`, or with no `hold` or `load1`; a reconciliation with no `ready` list,
no placement list, or a malformed entry: `unreadable`, and it REFUSES — re-capture and re-reconcile with this
checkout, because neither a spawn nor a rationale answers that arm. Capacity is judged first, so a held tick is
clean over any reconciliation. An EMPTY `ready` is clean: nothing startable is a real board state.

**Hatch** `SLOPWEAVER_ALLOW_IDLE_CAPACITY`, its own seam, so opening the sweep or load hatch never opens this.

## The recorder reads each document ONCE

With `--reconcile -` a second read of a consumed stdin returns nothing, so a gate re-reading it would take
its cannot-read guard and record the tick unjudged. All three gates run in
`src/cli/commands/supervisor/tickRecordGates.ts` over one read, and every refusing gate prints at once so one
re-draft fixes the tick.

**Residue, stated:** with `fleet: "unavailable"` placement comes from open runs, so a live seat on a RUN NOW
row can be unseen and the row listed — name it. The sweep gate's own spawn match has the same
session-subject blindness; the handover-subject rule above fixes the habit for both.
