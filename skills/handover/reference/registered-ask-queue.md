# A registered shape reaches the owner's Queue with no run behind it

Bundled reference for the `handover` skill, linked from [ask-shape.md](ask-shape.md).

A `kind: ask` row carrying its whole shape, `status: ready`, unsettled, that no run has ever opened, composes to
`WAITING ON OWNER` and publishes its summary as the `question`, `askedIso` as `questionAskedIso` and
an `ownerWait` naming the owner — so the Queue draws it as it stands, and `handover reconcile` never counts it ready or
starving. No `handover start` then `handover ask` is needed to put it in front of the owner.

**Why.** Measured: four such rows sat in `RUN NOW` for up to eight days, ranked as starving work
for a seat, while every chair pass named them as on the owner's Queue — and the owner searched it and found none of
them. The shape already says the row is the owner's: `--finding` and `--dispatch` are the declared rows that wait on
nobody's pick. Refusing a shaped row at register time until a run asks it was the other fix on offer, and was not
taken: it would have left every row registered before the refusal invisible.

**When it stops being the owner's.** The moment `handover rule` journals a ruling decided at or after `askedIso`,
the row returns to `RUN NOW` for a seat to execute the ruling — the same `answeringRuling` pick a run's question
makes, so an authored front-matter `ruling:` that cannot date itself keeps it the owner's. `handover settle` closes
it as ever.

**Keeping it current without a run.** `handover reconfirm`, `correct` and `withdraw` act on the row itself,
since a run is exactly what would take it off the owner's Queue: a reconfirm rewrites `stillReal:`/`stillRealIso:`,
a correction rewrites `summary:`, the body's heading and brief copy of the question and (`--still-real`) the check,
with `--why` as `statusSummary:`, and a withdrawal makes it `status: cancelled` with its reason — `CLOSED — NOT
SHIPPED`, never a settlement, which would read as the owner's. No claim is needed, as no run holds it, and no
journal is written. Measured: all three refused every such card with "start it first"
(`src/handover/registeredAskChange.ts`).

**A still-real line past its cap is repaired by the verb that replaces it.** The board reads that row
`CONTRADICTION` and `register-hygiene` blocks every push, so `reconfirm` and `correct --still-real` excuse exactly
that line's own cap breaks and refuse any other defect; the edited row must then read well-formed, or nothing is
written (`LEAVES_MALFORMED`), so neither verb can write an over-cap line either. Measured: both answered
"no run is open" to a 32-word line, and only a hand edit cleared it.

**What still places it elsewhere.** A run that opens owns the question from then on. An unfinished
`blockedBy` holds it in `NOT YET`, and the published row then carries no question, so the Queue and the board
cannot disagree. A paused, drafted or settled row keeps its own section.

**Residue.** The morning `session-start` board leg ranks only journalled questions, so it does not rank these
rows. `src/handover/registeredAsk.ts` carries the criterion; `src/cli/commands/handover/listJsonWait.ts`
publishes it.
