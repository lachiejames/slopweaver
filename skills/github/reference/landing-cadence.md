# The landing cadence, and the board rows a read registers

Bundled reference for the `github` skill, linked from [landing.md](landing.md). Loaded when the tick
invocation has to be trusted, extended or disputed.

## The cadence, and why `--if-due` is a mechanism

A per-tick fetch of every open pull request would cut into rate limits, so this is a rationed read. **A sentence
rations nothing; it only stops the read.** MEASURED with the ration held by prose: a chair's whole
shift went by without one, a pull request was dropped from the merge
queue two days earlier, and it sat conflicted with nothing noticing — which is exactly what the tick exists to
catch: every tick shows which pull requests are mergeable and which need something spawned to fix red CI,
comments or a rebase.

So the ration is a MECHANISM. **`--if-due` is what the sweep runs EVERY tick** (sweep-contract step 7), and
a tick whose cadence has not elapsed makes **no GitHub request at all** and exits 0 — the same contract
`automation due` has, so running it every tick costs nothing and a non-zero exit is a real fault.

- The register is the store's `landing_read_cursor` table, exactly one row per SELECTION — repositories
  lower-cased and sorted, then the author, so `--repo a,b` and `--repo b,a` are one selection — changed by
  compare-and-set on its `revision` and never retried: a writer that lost the race leaves the newer read
  standing and says so. Not a stream: only the LATEST read per selection decides anything. The press register
  (`landing_press`) is the stream, for the opposite reason. The old `landing-reads.json` is imported once, on
  the first operation, and never read again.
- **Default cadence 30 minutes**, `--cadence-minutes <n>` to change it, **at most 10080 (seven days)**. The
  default is chosen against the failure rather than against a budget: it turns _days_ into half an hour, at two
  reads an hour, where the read's one whole-fleet `compare` costs `rateLimit.cost` 1 of an hourly 5,000. The
  maximum is a REFUSAL naming the flag, exit 2, because past a week the cadence stops rationing the read and
  starts suppressing it — and because an unbounded one overflowed the range a date can express and crashed the
  tick with a bare `Invalid time value`.
- **Every VALID unknown answers DUE** — no record, a newest row dated in the future, and a cadence whose
  next-due lands outside the range a date can express — because the measured failure is a read that never
  happened.
- **Failed knowledge is not absence.** A store that cannot be reached, an import file that will not decode, or
  a stored row that does not decode REFUSES the tick before any GitHub request, exit 1 with the store's own
  sentence, and so does an unreadable press register. Reading such a doubt as "never read" would make a
  broken register look like an empty one.
- **Only a read that SUCCEEDED is recorded**, so a failed fleet read leaves the cadence due rather than
  inheriting a window it never earned. A completed read whose row cannot be written still prints its result,
  then exits 1 naming the lost row.
- Under `--json` a skipped tick emits `kind: "skipped"` with `lastReadAtIso` and `nextDueAtIso`, and a real
  read emits `kind: "read"`. **Never an empty read** — `{rows: [], dispatchable: []}` on a tick that never
  looked would read to a consumer as "the fleet is clear".

## `--register`: the dispatchables go on the ONE board

`--register` writes one handover row per `dispatchable` row and **spawns nothing**. Three reasons, each of them
canon already:

- **One board.** `AGENTS.md`: _"never write a status document, add a row."_ Made a row, a landing dispatchable
  ranks beside the owner's kept outcomes and the due asks in the sweep's own fill step — which is what "seated by the
  chair automatically" means here.
- **Capacity is measured at step 8 and filled at step 13**, both after step 7. A spawn here would happen before
  the reading that can `hold` it.
- **A second verb would cost a second fleet read**, which is the thing being rationed.

- **`merge-now` is never registered.** It is enqueued directly — sweep step 7, _"no seat to wait for, no wave
  to be in"_ — and inventing a seat lane is a measured failure.
- **De-duplication is two facts already here.** A row a LIVE handover row holds (the `BOARD` cell's own
  join, on the DERIVED status, so a settled ask whose file still reads `status: ready` is terminal) is
  skipped, and so is one that already ENDED at this head; a TERMINAL row at an older head does not block,
  because a settled row over a still-broken pull request must not hold it. `github bump-drive`'s
  seat asks the same `boardHold`. And the slug carries the head, so `handover register`'s refusal on an
  existing file makes a re-register at the same head idempotent while a moved head gets a fresh row.
- **Capped at 10 rows per invocation**, for the reader rather than for safety: the next read takes the rest.
- **Rows are NOT `--finding` rows.** The finding gate exists because a row nobody asked for became a pull
  request on a team-reviewed base under the owner's name. Neither half applies: the pull request already exists,
  it is already team-facing and already the owner's, and `AGENTS.md` rule 10 names clearing its CI, comments and conflicts as
  the fleet's own work. Marking these findings would make the gate refuse the very work rule 10 asks for.
- **They are `--dispatch` rows.** Without the flag, `handover register`'s ask-shape gate reads "not a finding"
  as "a decision waiting on the owner's word" and refuses the argv this verb composes — an `--ask` with no
  `--problem`/`--options`/`--lean` — on every row (MEASURED).
  `--dispatch` declares the property the gate actually needs (nothing here waits on the owner's word) without a
  finding's provenance or its team-facing hold, and it is refused beside `--finding` or any shape flag:
  [ask-shape.md](../../handover/reference/ask-shape.md).
- **A failed registration names its EXIT CODE and no cause.** `handover register` writes the file before it
  mirrors, so a nonzero exit does not even establish nothing was written; reading every failure as a duplicate
  slug is what hid the refusal above.
- The row declares `branch: <head ref>` via `handover register --branch`, which is what the next read joins it
  by, beside the branch its seat's run records at `handover start`. Name similarity is never used — the join
  is a stated branch, declared or recorded, and nothing else.
- **A row parked at rest with its seat closed and NO wake holds nothing**, because `handover wake` never reseats
  it: its draft reads `finish-or-card-close` again and the skip names `cmux spawn <slug>`, never a second row
  ([dispatch.md](dispatch.md)).

### Drafts are a reading of their own, never `--include-drafts` on the press read

`--drafts-only` selects `draft:true` server-side on its own `--if-due` ration (the selection key plus `#drafts`)
and refuses `--press` and `--record-reading`, so the press read is byte-for-byte what it was however many drafts
the owner has. The tick takes it as a second reading, `landing-drafts`. MEASURED: four of the owner's drafts sat red
for days, the press read excluding drafts and the `hygiene-sweep` row meant to read them absent from the store;
three Codex passes broke folding drafts into the press read — a shared cap, a shared `--limit`, a shared fleet
time budget (`src/cli/commands/github/landingDraftsOnly.ts`).

### `--register` also SETTLES a row whose pull request ended

Registering sees only OPEN pull requests, so on its own nothing takes a row off when one merges or closes.
MEASURED: a landing row sat `ready` for ten hours after its pull request merged, and the fill step seated a session whose whole run was finding that out. So the same pass ends
what it began (`src/review/landingClosure.ts`, `src/cli/commands/github/landingClosureRun.ts`):

- **The census narrows, a per-pull-request read decides.** A landing row of a selected repository whose number
  a READ open census no longer lists is a candidate; an `unread` census contributes none. Each candidate is
  read on its own and only a MERGED or CLOSED answer settles, `handover settle --as answered` with a witness
  naming the merge commit and instant, or the close instant. Never `declined`: a decline is the owner's, with a reason.
- **Only a `ready` row nobody is on.** The authored `ready` survives a seat starting, so the RUN decides: a run
  that never started or finished its cycle is settled; an active or waiting one ends with its own seat; a
  `paused` row waits on a person; an orphaned or unreadable run is left for a session. Each prints `held` and why.
  The row is judged THREE times — the board snapshot, a re-read once GitHub has answered, and a precondition
  `handover settle` asks over the very bytes it splices, with nothing awaited before the write — since the verb
  checks no status of its own and a row can be paused or started mid-pass. Residue:
  `handover start`/`pause` do not take the settle's lock, so a same-millisecond write from another process is
  the race every `handover settle` already has.
- **Capped at 20 reads per invocation**, the rest `skipped` for the next read. `--dry-run` prints
  `would-settle` with the witness and writes nothing. A failed settle names its exit code: the verb writes the
  row before its mirror, so a nonzero exit does not prove the row is still open.

## `--press` on the tick, which is the half the owner asked for twice

A pull request that is green, mergeable, has two human approvals and shows 'Merge when ready' simply needs the
button pressed, and graduated autonomy covers pressing it. A chair once pressed one by hand minutes after
it was noticed.

So the tick invocation carries `--press`, and a green mergeable row is ENQUEUED in the same pass that found
it. Nothing is seated for it and no chair has to remember: sweep step 7's own "ENQUEUE DIRECTLY, and there is
no SEAT" is what the verb does rather than what a reader is asked to do.

- **Every one of the owner's and every bump in ONE pass; three per repository of anybody else's.** A row of an
  `--author @me` read or a dependency bump is covered by the owner's auto-merge rule, so it is never held for
  a later pass; a colleague's green row an unscoped read reached is capped at three per repository, so a
  wide read is still not an unattended wave ([why the global cap went](../../../docs/doctrine-rationale/rule-1.md#the-press-cap-that-made-the-owners-word-wait)).
- **Every guard still applies**, because `--press` calls `github enqueue` in process: the merge hold, the
  opt-out label, the head re-read and the conversation re-read immediately before each click, and the
  `mergeQueueEntry` read-back. A row the dispatch layer sends to THE OWNER is never pressed.
- **TWO findings the press answers for itself, each on its own criterion and neither on the other's.**
  `codex-loop-incomplete` rides a standing human approval; `ci-rollup-superseded` rides a replacement this
  read PROVED. Both are computed from the press-time re-read, both are filtered by subject, and a press that
  answered neither hands `github enqueue` exactly the argv it would with no waiver.
- **The pairing floor, the first one.** `codex-loop-incomplete` fires for a head no
  checkout on this machine holds — which is every pull request of the owner's a human wrote and humans reviewed — and
  re-running the enqueue by hand with `--acknowledge codex-loop-incomplete --reason "…"` is what a chair once
  did by hand. So the press names that subject ITSELF when a **standing human approval** covers the pull request — the logins
  `approvingLogins` keeps, which excludes the author, every bot and a withdrawn approval, read from the
  press-time conversation rather than from the read that judged the row, and never on a truncated reviews
  page. **Nothing else is waived**: `unacknowledgedEnqueueFindings` filters by subject, so red CI, a
  missing required context and an unmergeable branch all still refuse.
- **Why an approval and not "it passed the six tests".** `codeowners-satisfied` passes on an EMPTY owner
  list, so a pressable row is not evidence anybody read the diff — a pull request of the owner's touching no
  CODEOWNERS rule passes all six with no reviewer at all. Waiving the pairing floor there is the measured
  failure: a floor acknowledged every time is not a floor. The bound is carried entirely by
  the approval, because one subject covers every way the loop can be incomplete and there is no way to
  acknowledge only the could-not-examine arm.
- **The reason is a CONSTANT, written once** (`PRESS_CODEX_WAIVER_REASON`, `src/review/reviewSignals.ts`), so
  a door-ledger row an automatic press wrote is told from a chair's hand-typed one by the string alone. The
  door records it **only when the finding actually stood** (`enqueueRun.ts`), so a press over an already-clean
  floor writes no waiver and the ledger's count stays honest. The dry run says the waiver would be made, and
  the autonomy row says it was. When a press waives BOTH findings the constant is a SUBSTRING of the recorded
  reason rather than the whole of it — `--reason` is one flag, so the two sentences are joined with `; ` and
  each row carries both. Grep for the constant, never match on it.
- **The superseded rollup, the second one — and its reason is EVIDENCE rather than a constant.**
  `pr-body-gate` re-runs `dev-gate` on every body edit, and GitHub's rollup folds the earlier FAILURE in
  forever while every check on the head passes, so `ci-rollup-superseded` would refuse every such green
  merge-now row (measured: several, each re-done by hand). The press names the subject
  ITSELF, but **only on a proof** (`rollupSupersessionProof`,
  `src/live/github/rollupSupersession.ts`): every superseded run still pinning the rollup must carry a LATER run of its
  own name on the SAME head, ordered by GitHub's own two timestamps. The `--reason` is that proof's own
  sentence, naming each replacing run id, so the ledger row says which run cleared it without a reader
  opening GitHub.
- **Three refusals in the safe direction, and the press SAYS which one it hit.** A truncated check page (a
  failing check may simply not have arrived), a failing rollup no superseded failure explains, and a pinning
  failure with no later run this read can name all answer `unproven` — and that sentence is printed beside
  `github enqueue`'s own refusal rather than leaving a reader to guess. A live red is not reachable here at
  all: the finding is raised only when the latest-per-name view has ZERO failures, and a standing red is
  `ci-not-green`, a subject the press never names.
- **A press leaves an autonomy-ledger row** — `press-merge-when-ready`, naming the pull request, why it was
  obvious and the verb line that witnesses it. `AGENTS.md` rule 10's other half is that an unasked act is
  RECORDED: a press with no row is invisible in the briefing's "done for you, without asking" section, which
  is indistinguishable from a press nobody made.
- **Every press gets its own row, a second press at the same head included.** The id is
  `enqueue-<owner>.<repo>-<number>-<head>`, and a re-press at that head (the queue let the entry go, the next
  pass pressed again) is `…-2`, `…-3`: measured, three such re-presses were refused a row under the
  first press's id. A retried write of one press reuses its id rather than adding one (`pressOccurrenceId`).
- **A press whose row cannot be written is not made.** The ledger is read, and checked writable, before the
  press; a failure is `not pressed: the autonomy ledger could not be read or written (…)`, dry run included.
  A write refused AFTER the check (a busy lock, a racing press taking the ordinal) is re-read and retried,
  three attempts 250ms apart. Only a write that still fails leaves the outcome saying both — the enqueue
  happened, and the owner's briefing will not show it.

## `handover register --branch`, which is what makes the join work

The row is written with `--branch <head ref>`, and that flag exists because the board's `branch:` front-matter
is the ONLY thing either reader will join on: the landing table's `BOARD` cell, and the team-facing gate on a
`--finding` row. Name similarity is the fuzzy matching this repository forbids — a wrong `in-flight` guess
once hid a fortnight of work — so a row declaring no branch is invisible to both, which is what `none?` means.
