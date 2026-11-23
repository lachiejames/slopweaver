# Where the workstreams live

There is no written register of what is in flight, and there is never going to be one. This file explains
what replaces it, because the replacement is not obvious and its absence keeps getting mistaken for a gap.

## The board is the register

`slopweaver handover list` is the register. Read it there and nowhere else.

Every workstream that is real enough to execute has one orchestration doc under `$SLOPWEAVER_HOME/handovers/`.
The doc carries the goal, the measured state and the constraints. Its `status:` line is the authored intent, not
the row's state: the state is DERIVED from the row's register — a settlement, a `closed` or `abandoned` journal
event, and only then the authored line ([derived-row-state.md](../skills/handover/reference/derived-row-state.md)).
The board composes that with repository probe evidence and the run journal rather than trusting either alone,
and disagreement is surfaced loudly rather than one silently overruling the other:

```bash
slopweaver handover list            # non-terminal work by default — runnable, in flight, waiting, contradictions
slopweaver handover list --all      # also shows DONE and CLOSED — NOT SHIPPED (cancelled/rejected)
slopweaver handover list --json     # the same board for a CALLER — every row, `section` to filter on
slopweaver handover resume <slug>   # rebuild one run's brief from its journal
```

**A program reads `--json`, never the printed board.** The rendered form is sections, banners, a truncation
caveat and a typo'd-slug footnote — every one of those right for a reader and wrong for a caller, and a
heading reworded breaks a parser silently. `--json` projects the same `BoardModel` the rendered board reads,
so the two can disagree about presentation and can never disagree about placement. It emits EVERY row,
including the closed sections `--all` governs, because a caller filters on `section` and cannot recover a
row that was dropped before it ever saw one. Each row's `status` is the derived one, with the authored line beside
it as `authoredStatus` and what decided it as `statusFrom`. The work console's Fleet and Queue pages read it.

A doc declares `doneWhen:` probes — conditions checked against the repository — and the board's precedence
engine (`src/handover/boardState.ts`) composes the declared `status:`, that probe evidence, and the run
journal's current disposition into one placement, applying a fixed rule order rather than letting either
input silently overrule the other. A genuinely FINISHED run with every probe passing confirms `DONE`
outright, with no manual edit to go stale. A landed proxy
with no finished run instead prints `LOOKS SHIPPED` and stays non-startable, pending confirmation. Where the
declared status and the repository genuinely contradict each other — a `done` doc whose probes now fail, a
`cancelled` doc whose probes now pass, a terminal doc with a live run — the board prints a `CONTRADICTION`
row instead of picking a winner, and that row is never hidden by `--all`'s absence.

Two statuses are terminal-but-not-shipped, distinct from `done`: `cancelled` (the work will not be pursued)
and `rejected` (explicitly not accepted). Both, like `done`, are hidden from the default board and shown
with `--all`, under `CLOSED — NOT SHIPPED`, each carrying its `statusSummary:` reason. A `statusSummary:`
field — distinct from the stable `summary:` — is required when `handover check --require-status-summary` runs, never retroactively, and answers what an agent needs before acting: confidence in the present state, what is
blocked and on what, what human input remains, and why any declared dependency is real.

So the register cannot go stale on its own, because a genuine change in the repository or the journal is
composed in on the very next read — no field has to be remembered and edited by hand to keep up.

### What keeps the register readable

Composing status with the repository stops the board from rotting; it does not stop the register from filling
with rows nobody will read. That needs a gate, and `register-hygiene` in `yarn lint` is it. It refuses a
`status:` the parser does not accept — the value that makes a doc _silently_ unclassified rather than loudly
wrong — a doc with no `artifact:`, a `blockedBy` naming a slug no doc claims, and a doc whose every declared
probe passes while its status is not `done`.

That last one is the one that matters, because it is how work lands without the register being told: the board
prints it as `LOOKS SHIPPED`, and it is explicitly excluded from `RUN NOW` — not offered as runnable — pending
confirmation. No read flips it — a probe proves a symptom is absent, which is weaker than a scope having
shipped — so confirming it is an ACT, and the gate is what makes that act get done rather than deferred. That
confirmation is `slopweaver handover close <slug> --summary "<what shipped>"`, never an edit to `status:`: a
row's state is DERIVED from its register (see
[derived-row-state.md](../skills/handover/reference/derived-row-state.md)). A session may take it without a
person: `slopweaver sweep board` calls a `LOOKS SHIPPED` row whose declared probes all pass `SHIPPED`, and
`slopweaver sweep apply <slug> --session <id>` re-classifies the row WITHOUT running a `command:` probe — so a
row only a command probe proves is refused, never closed — then runs that `handover close` for ONE row and
journals it, so `sweep list` is the record of what was taken ([sweep](../skills/sweep/SKILL.md)). A `cancelled`/`rejected`
doc whose probes land instead gets a distinct gate finding naming the contradiction, never advice to close
it — that would silently reverse a deliberate terminal call.
The register lives under `$SLOPWEAVER_HOME`, so the gate examines nothing in CI and says so instead of
reporting clean.

Two verbs keep the board short, beside the gate. `slopweaver handover prune [--priority p0|p1|p2|p3]` is the
report-only trimmed board — which rows still earn their keep, and a count of those the register already decided
(`--verdicts` lists each with its witness) — so a printed row list is pruned before it is read as a queue.
`slopweaver sweep board|apply|list` is the acting half: classify every live row against its evidence, perform
one row's register verb, read back what was taken. A SHIPPED close needs no person; an ORPHANED or SUPERSEDED
row settles `declined`, which is the owner's alone, so `apply` takes it only with the owner's `--reason` and `--anchor`.

Docs whose work is finished move into `handovers/archive/`, which the scan does not read. A doc absorbed into
another carries a backlink to the canonical slug that took its work — archiving takes a row off the board, and it
must never take the commitment with it.

## Why a hand-written list is the wrong answer

A document listing every current workstream starts rotting the moment it is saved, and a stale register is
worse than none: it is read as authoritative. This has cost real work — duplicate pastes into a conversation
that had already shipped, and two competing pull requests for the same fix, both traced to a board that was
accurate when written.

That is not a discipline problem. It is a design problem, and the fix is that **this file is never that
list** — the board is a live composition of authored intent, repository evidence, and the run journal, read
fresh on every `handover list`, rather than a document someone has to remember to keep in sync.

Two rules follow, and they are why this file contains no list:

- **No counts and no per-workstream enumeration here.** Anything enumerated in prose goes stale. Every number
  in this repo's docs is either derived by a command or absent on purpose — see the same reasoning in
  [AGENTS.md](../AGENTS.md), which is loaded into every session as instructions and so must never carry a
  fact that can rot.
- **A doc is created when work becomes real**, not when it becomes interesting. Real means there is code,
  a branch, an open pull request, or a commitment to execute. An idea in an artifact gets no doc, because a
  doc is a promise to finish and a board full of unstarted promises is the stale register again in another
  costume.

The important failure to watch for is the inverse: **a branch or a pull request with no doc.** That is work
tracked nowhere, and the board cannot show you what it has never been told about. Cross-reference the
repositories against the board, not the board against itself.

## The owner's outcomes are a different register, and a narrow one

The console's Workstreams page (`/workstreams`) is not this board. It shows the owner's OUTCOMES: the handful of
things the owner drives that outlive every board row under them, each carrying its own milestones up to its definition of done. They live in the store, a row per workstream
([the model](store/workstreams.md)), written by `slopweaver workstreams put` or by the owner's word on a mined candidate
(`workstreams react`, `define`, `retitle`), each one store transaction judged by the same rules, and read by
`slopweaver workstreams list --json`; the code is
`src/workstreams/` and the rules are the [workstreams skill](../skills/workstreams/SKILL.md).

It is a written register, so it carries the rot risk above, and three things narrow it:

- **No progress figure is typed.** A milestone is done only when a dated entry finishing it carries the link that
  proves it, and progress is derived from those (`src/workstreams/store/derive.ts`). The story is written; the bar is
  derived from the story's citations.
- **It holds outcomes, never work in flight.** A pull request, a branch or a next step belongs on the board. A
  register that started listing those would be the stale list this file rules out.
- **Linear becomes the list.** The owner's grouping puts each outcome in a Linear project with the same five milestones,
  so once that realignment lands the register's list of workstreams is read from Linear rather than kept here.
  Until then, a tile's links carry its Linear project where one exists.

The fleet's own placement against the board is on `/fleet`.

## The board shows what has surfaced; the claim shows what is in flight

The board answers "what work exists". It cannot answer "what is another terminal building right now", and that
gap once cost four duplicate builds in one night — two pull requests for one connector fix, two
pull requests adding the same entry to the same list, competing larger fixes for three tickets, and a whole
agent run launched over a scope another session had already opened a pull request for. A run mid-flight in
another terminal is invisible until its pull request appears, and by then the duplicate is written.

So every live run holds a **claim**: the set of files it is building. The claim is derived, never registered —
from the doc's `doneWhen:` probe targets, its declared `outputs:`, and the branch its journal recorded. There is
no registry to maintain, because a claim nobody updates is worse than no claim at all.

The claim is on the **artifact**, never on the doc. Two sessions opening differently-named docs for the same work
still collide, because what is compared is the branch and the paths — not the slug. That is the bypass that
matters: three of the four collisions above were two docs, or two tickets, describing one change under different
names, and a gate keyed on the board entry would have waved every one of them through.

Nothing is ever acquired, so there is no lock to go stale and no corpse to steal. Every check recomputes liveness
and the holding session from the journal on disk, which means ownership is re-verified on every call rather than
once at acquisition.

```bash
slopweaver fleet status              # every live run on the machine, with what it claims and the session holding it
```

**The claim REPORTS; it never refuses.** Operating-doctrine rule 2 leaves no headless launcher for it to
gate, so it answers the question: `fleet status` shows every live run, what it claims, and the session
holding it. **Reading it before you start is a discipline rather than a fence** — the same trade every other
guard here makes, and better stated than pretended.

A claim **expires** with its run: a recorded process that is gone holds nothing, and neither does a journal
that has stopped moving. A claim that outlived its process would be a new silent failure rather than a fix.
Note the known weakness — a pid is not a session identity, so a run whose process id has been reused, or
whose session is alive but quiet, can be reported wrongly. Do not treat this as liveness you can trust.

### What the gate does NOT cover, stated rather than implied

- **It is scoped to one repository.** Two runs in different checkouts never collide, however similar their
  paths or branch names. The private work repository this plugin cannot see is out of reach, and the third of
  the four collisions happened there — nothing here would have caught it.
- **It compares files, not intent.** Two docs describing the same change at different paths do not overlap, and
  neither do two implementations of one fix that chose different filenames. Whether the unit should be coarser
  is an open question recorded against the feature's own doc, not something the code decided quietly.
- **A doc can claim nothing.** One whose only probe is a `command:` probe names no path. "No overlap found"
  computed from an empty claim is ignorance, and it must be read as such rather than as safety.
- **A long quiet session can outlive its own claim.** Expiry needs the process AND recent journal progress, so
  a session that thinks for a long time without writing an event can lose its claim while still working. The
  AND is kept anyway, because resting on the process alone would let a rebooted machine hold a claim forever
  on a pid something else now owns.
- **It says nothing about the doc.** `handover check` is untouched: a doc that overlaps a live run is still a
  valid doc.
- **It never touches the other run.** It reports and steps aside. Offering an exit that writes to a neighbour's
  journal is what produced two competing all-green pull requests in the first place.

## A run ends in one of three ways

A run is an execution of one doc. It ends in exactly one typed transition, recorded in
`$SLOPWEAVER_HOME/runs/<slug>.jsonl` — a file, so the ending survives both compaction and session death:

```bash
slopweaver handover finish <slug>                 # done — refuses while any gate below still holds
slopweaver handover ask <slug> --problem "…" --options "…" --lean "…" --risk "…" --blast-radius "…" --still-real "…" --question "…"
slopweaver handover abandon <slug> --why "…"      # give up, explicitly
```

`finish` refuses while a declared probe still fails, while a pull request `github stack push` raised on the
run's branch has checks nobody has read with `github checks` (short of that gate's named escape hatch), and
until the run says whether it learned anything — a recorded lesson, or `--lessons none`. Refusing is a
feature. It is the board declining to record a green it cannot see, and routing around it converts a
measurement back into a claim. `ask` is blocked on the owner, and the verb refuses it unless all six shape
fields come beside the question (short of its named escape hatch), because an ask the owner has to parse is
a defect; the question it journals keeps the problem, options and lean, and drops the other three — an ask about a message carries the message as `--action` and derives its options from it:
[ask-shape.md](../skills/handover/reference/ask-shape.md). `handover pause <slug> --on <who>` is not an ending:
it parks a still-live row on a named person, with no deadline.

**A recorded question is a legitimate ending, not a failure.** Writing down the thing only the owner can
settle — a spend decision, an irreversible external change, whether two efforts are one workstream or two — is
the wanted artifact. It is also the escape hatch from every gate here, so nothing needs to stall silently.
What is not acceptable is a run that simply stops: an untyped ending leaves the board describing a state that
no longer exists, which is exactly the rot this design removes.
