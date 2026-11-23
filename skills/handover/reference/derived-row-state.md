# A row's state is DERIVED — there is no second copy to keep in step

Derive the state, delete the second copy: state generally should be derived.

## The defect, stated as what it actually is

Not "the board is stale". `handover list` composes doc + probes + journal and reads a settled ask correctly
already. The defect is that **two readers of one row give different answers**, because every cheaper reader
filtered on the `status:` LINE — and nothing in this repository has ever written that line.

MEASURED on the live board, and the growth is the argument: **25 settled asks read `status: ready`** at the first
reading, and **60 of them** a day later, out of 249 settled rows in 1,431. Re-measure:

```bash
grep -l '^settlement:' ~/.slopweaver/handovers/*.md | xargs grep -l '^status: ready' | wc -l
```

The parent row is its own witness. `board-state-cannot-be-forgotten` was settled by running exactly the verb
its own "How this ends" specified, and came out carrying `settlement: answered` beside `status: ready` — the
defect produced by correctly following the documented procedure on the row that documented it.

## What derives, and from what

`src/handover/derivedRowState.ts` answers a row's state in one place, and every reader asks it. The
precedence, first match wins:

1. **A settlement** — the ROW's terminal. `filed`/`answered` derive `done` (the owner's ask WAS actioned, which is
   the number the register exists to report); `declined` derives `rejected`, because an ask talked away and
   an ask actioned must never be counted together.
2. **A `closed` event**, anywhere in the journal — the work shipped, said by the verb that knew it.
3. **An `abandoned` event** in the current cycle — a session considered the work and gave it up.
4. **The authored `status:` line** — the row's declared intent, and still the answer for the **422 of 1,431**
   rows with no journal at all.

`orphaned` appears nowhere in that list on purpose: it says the SESSION died, never that the work stopped, so
a reaped row stays exactly as runnable as it was.

The two scopes in steps 2 and 3 differ deliberately. `closed` is read across the WHOLE journal because the
case it exists for is a row whose probes already pass and which nobody ever ran — `currentCycle` on such a
row is empty. `abandoned` is read only from the last `started`, because giving up is a judgement about the
cycle a session was in: a row abandoned in July and restarted in September is not abandoned.

## The safety property: MONOTONE toward terminal

The authored line is still the answer wherever the register is silent, so every row reads exactly as it did
unless its journal carries an ending the front-matter never got. The derivation can move a row from live to
terminal; it can never move one from terminal back to live.

That is why it holds over 1,431 live rows with **no doc rewritten**, why the journal-less rows are the ordinary
case rather than an exception, and why a journal with an unreadable line degrades to the authored answer rather
than to a wrong one. The `status:` lines stay until the store decision is made, before a database schema is built.

## The verbs that write the register

```bash
slopweaver handover close <slug> --summary "<what shipped>" [--artifact <url>]
slopweaver handover artifact <slug> --url <where the answer was published>
slopweaver handover rule <slug> --anchor <where the owner said it> --words "<the owner's words>" [--decided-iso <when>]
```

**`close` is not `finish`.** `finish` closes a RUN CYCLE: a session stopped and its probes were weighed.
Whether the change is live is a different question, asked later, when a pull request merges. `close` answers
that one — so it needs no open run, and it is the verb for the `LOOKS SHIPPED` row `finish` correctly
refuses. It writes NOTHING to the doc; the board derives `done` from the event on its next read.

Both execution doors refuse a row that recorded a shipment, whether or not it ever had a cycle, and a second
`close` is refused: work cannot ship twice.

**`artifact` supersedes by append.** `addFrontMatterFields` is add-only and REFUSES a key the doc already
declares, so the front-matter can never CORRECT a row's artifact URL, and a settled row would point at a dead
witness for ever. The last `artifact` event wins, and every
earlier value stays on the journal. `list --json` publishes that DERIVED `artifact` (never a bare `artifact: null`); a
Queue card cites a web or file one as its first chip, else is refused (`site/lib/cardPages.ts`).

**On a settled row, the artifact is where it is READ; `settlementWitness` is what was published.** A second
`settle` is refused (`alreadySettledRefusalLines`, `src/handover/settleEnding.ts`), so the witness keeps the URL
of the settling moment — after a republish, repoint with `handover artifact` and never hand-edit the witness,
which would make the record lie. A sweep or board reader judges reachability from the derived `artifact`, and
provenance from the witness; judging reachability by the witness reports live rows stranded.

## A ruling is a row event too, and it supersedes by DECISION time

A ruling derives from state the way the board derives everything else, as opposed to a more lossy form of
communication or state tracking.

**The defect it closed, MEASURED.** `handover answer` writes the owner's ruling into the run journal and
never touches the row. Of **333 `answered` events across 241 runs**, 45 declared a ruling in so many words and
**39 sat on a row whose own text had nowhere to carry one** — 29 of those with over half the ruling's own
vocabulary absent from the whole document. So a sweep reported that a JIT-refresh lock the owner had ruled on
the day before had never been decided, and nothing on the board could have contradicted it. Reproduce by
counting `answered` events under `~/.slopweaver/runs/*.jsonl` and checking each row's front-matter for
`ruling:`.

So `handover rule` writes a `ruling` event and **no document at all**, on any row kind, and the front-matter
pair stays the fallback for the 90 rows that already carry one.

**It supersedes by the latest DECISION, not the last line — and that is the one place it differs from
`artifact`.** An artifact is a POINTER, so the last one written is simply the truer one. A ruling is a dated
decision, and the two orders come apart the moment a backfill exists: the backfill of the 39 standing rulings
appends today's lines about decisions the owner made in August, so append order would let an old decision displace a
new one. `decidedIso` is what a row orders by, `atIso` records when the line was written, and every earlier
ruling stays on the journal.

**A reconstructed ruling is a record, never a permission.** A backfilled event carries `backfilledFrom` — the
`answered` event it was copied out of, whose decoded answer it must equal byte for byte or the write is
refused. The team-facing finding gate reads a SEPARATE projection that skips reconstructions entirely, so a
backfill can neither open a door the owner never opened nor close one the owner did.

**A ruling that CONSTRAINS a verb carries a gate, so the verb refuses rather than a chair remembering.**
`handover rule … --gates "<noun> <verb>"` makes a DM-only ruling, a hold or a no-post-today bite at the CLI
dispatch boundary in every session on the machine, with no hatch, lifted only by `handover gate release <id>`
under the owner's own anchored word: [ruling-gates.md](ruling-gates.md).

**A ruling never moves a run's phase or releases a drive.** It is not an answer: recording what the owner decided
about the work says nothing about whether a cycle is waiting on the owner.

**`handover audit-rulings` is how you check it, and it writes nothing.** It reads the board, the archive and
every journal under `runs/` — `scanBoard` alone never reads the archive, and one of the 39 sits there — and
reports what each row reads as decided, every earlier ruling, and each answer no reconstruction names.
`--manifest <path>` (`{ schemaVersion: 1, entries: [{ slug, sourceAtIso, words, anchor }] }`, per-install
state, never committed) checks a reviewed list: an entry is **decided** only when exactly one ruling names its
source in `backfilledFrom` with the manifest's exact words and anchor, and the source still passes the writer's
own source rule. A live ruling saying the same words does not count; a later decision leaves it decided with
`historical` placement. Exit 1 on any unreadable input (a directory, a doc, an undecodable line, two docs
claiming one slug) or any unrepresented entry. It does not guess which unclassified answers are rulings, and
says so in every report.

**`handover backfill-rulings --manifest <path>` writes the ones the owner gave before the event kind existed**, as
reconstructions of the answers that recorded them, and `audit-rulings` over the same manifest is the proof:
[ruling-backfill.md](ruling-backfill.md).

**A stale checkout cannot SEE a ruling, and keeps working over one.** A build whose decoder predates the kind
reads a ruling line as UNREADABLE. `parseLedger` reports a well-formed line whose kind it has no case for in a
second bucket, `unknownKind`, and the OWNERSHIP guards read
`ownershipAmbiguousLines` instead of every unreadable line, so `ask`, `answer`, `abandon`, `finish`, `amend`,
`claim` and `release` keep working over one. The test needs no knowledge of the kind: ownership folds only
from lines carrying a `sessionId`, so a line declaring none cannot change who holds a run. Phase-sensitive and
correctness guards — `rowEvent.ts`'s `orphaned` and `ruling` write guards among them — deliberately keep
reading the whole set. Only a build carrying the reader makes the decision legible.

## The write path: one door into the register

`src/handover/rowEvent.ts`'s `applyRowEvent` is the only supported way to write a row event, and it is four
acts or none:

1. **Validate** against the per-kind Zod schema (`rowEventSchema.ts`). A refused event is never coerced and
   never partially written.
2. **Guard the transition** — a second terminal on one cycle, a second `closed` anywhere, an `answered` with
   no open question. Deliberately narrow: anything needing the doc, the repository or the session registry is
   a VERB-level judgement, and a weaker copy of it here would be worse than none. A `ruling` additionally has
   its EVIDENCE checked here — no duplicate decision, and for a reconstruction exactly one `answered` event at
   the named instant whose answer equals its words. Over a journal with an undecodable line a LIVE ruling is
   still appended and the write hands back the lines it skipped, which `handover rule` states (count, lines,
   and the word this checkout predates); only a reconstruction is refused, since its source is a claim about
   exactly the lines nothing can read.
3. **Append.**
4. **Read the file back and compare.** A write whose read-back does not match is a FAILURE, not a warning.
   The files backend needs that fourth act; `INSERT … RETURNING` would not — which is why the CONTRACT is
   "one act, all-or-nothing" rather than any particular primitive.

Three enforcement layers: the Zod schema at the verb, the type system at compile time,
and — if this register ever moves onto a store — a per-kind CHECK constraint at the column, the only one of
the three that also catches a write which did not come through this path at all.

## What is deliberately NOT here

**The transactional outbox.** A row event and an outbox entry committing in one local transaction, so a
mutation is committed to GO off-machine with no network in the critical path, is drafted and correct. Its
TARGET is open: there is no third place, which leaves where an outbox drains to undecided
without touching the mechanism. `applyRowEvent` is built to have one added inside step 3 and carries none.

**`settlement:` still lives in front-matter.** `handover settle` writes it there, with `cardDisposition:` and its
card beside it on a relay row over a hand card; moving that write into the register would change six more
readers. Reading it through the derivation is what closes the measured defect; moving the WRITE is a separate
change with its own blast radius.

## One settlement READ, because two readers gave two answers

`askRow.ts`'s `settledAskOf` is the only place a door or a ranking may learn that an ask is settled. It exists
because the alternative was measured and it lies in the direction that costs work.

MEASURED on the live board: a review-ask row was settled
`answered`, so `cmux spawn` refused it by name — while `handover reconcile` called it the board's ONE starving
row and its ONE stale ask, because the row's own run journal read `abandoned`, which places it in
`CONTRADICTION` rather than a closed section, and reconcile ranked every section that is not closed. Two
registers, two answers, and the fill scan believed the one that said there was work to do. Ranking settled
rows was not a one-row slip either: excluding them took the ranked count from **638 to 584**.

Reproduce either side with `slopweaver handover reconcile --json` and `slopweaver cmux spawn <slug>` against
any row that carries `settlement:` beside a journal that never ended.

The rule the fix follows: **a run's ending says what happened to a CYCLE, and a settlement says whether the
ask was ACTIONED.** Only the second decides whether work remains, so only the second may drive a ranking or a
refusal — and it is read in one function so the two can never drift apart.
