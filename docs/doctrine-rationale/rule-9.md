# Rule 9 · Pair with Codex on non-trivial work

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule: use Codex to help with planning and reviewing, because Claude and Codex work better together than either
does alone — Codex plans, Claude implements, Codex reviews and finds the gaps. It is a standing rule rather than a
habit because a class of instruction given repeatedly kept coming back wrong, and the empirical evidence is that a
single brain will not get all of it and will make the same mistake again.

**What this settles, and the much larger part it does not.** When to run a Codex pass is agent judgement, and
keying it to which part of the codebase a diff touches is rejected: a heuristic written for it would fall to edge
cases and build a worse product. Rule 9 takes exactly one clause out of judgement — **whether to pair at all**. The
area ban stands, enforced by construction, because the floor names no area: it asks whether a plan and a review
happened on this branch, in any checkout holding the pull request's head commit, and nothing else. How many passes, and which falsifiable property each
attacks, remain judgement. Reading rule 9 as licence to write a class-based rule would revive exactly what was
rejected.

## The floor, and why its two halves are judged by OPPOSITE freshness rules

`loopFailures` (`src/codex/ledger.ts`) requires one conclusive review that is **CURRENT**, and one conclusive
`READY` plan that is **STALE**. That reads like an inconsistency and is the load-bearing part. A review over a
tree that has since changed does not describe the code being landed. A plan reads the tree BEFORE the work
exists — so requiring a plan to be current would reject the intended sequence by construction and accept only
the post-hoc plan the rule exists to prevent. STALE is the one fact already on the record that says the tree
moved after the plan started.

**What STALE proves, exactly, stated because it is less than it looks.** That the tree changed after the plan
read it. Not that the plan caused the implementation. One bypass survives — plan post-hoc, make one more edit,
and the plan is STALE — and it is left standing rather than papered over, because it is a deliberate act with
a record of it. The failure being closed is the SILENT one: a plan and all three reviews skipped on a merged
pull request, noticed by nobody.

## Why it had to reach the landing verbs, not just `validate:pr`

Because `yarn validate:pr` is a package script and nothing makes anyone run it — no workflow invokes it, and
it is deliberately kept out of `yarn validate` (`docs/constraints.md`) because ordinary build laps run long
before any review exists. A rule enforced only there is a rule enforced nowhere. So `github enqueue` and
`github merge --admin` ask the same question immediately before the mutation. When nothing on the machine can
answer it, the answer is "could not be examined" and that costs exactly what an incomplete loop costs — otherwise
every future gap in association silently becomes a pass.

**The subject is the PULL REQUEST, and getting that wrong makes the floor unfalsifiable.** Asking four facts of
the CURRENT checkout — same origin repository, same head branch, same head commit, clean tree — fails by
construction for a session dispatched under [rule 10](rule-10.md) to press someone else's pull request: it
authored no diff and stands on no relevant branch. `--acknowledge codex-loop-incomplete` becomes the only route
through, and a floor acknowledged every time is not a floor (a fleet finding). So the read folds every checkout on
the machine whose `origin` is the repository and which HOLDS the pull request's head commit, and judges freshness
against that commit's own tree.

**It is not a loosening, and the arithmetic is why.** A fingerprint is
`sha256(len(treeSha) + ":" + treeSha + dirtyPatch)`, so for a clean tree it is a pure function of git's tree
object — and the four checkout checks only ever ADMITTED a checkout sitting clean at the head commit. The value
judged against is therefore byte-identical to the one those checks computed wherever they permitted anything at
all; what is gone is a precondition about who was standing where. `commitTreeFingerprint`
(`src/codex/gitDiff.ts`) computes it from any checkout holding the commit, and
`unit/codex/commitFingerprint.test.ts` is the standing witness that the two agree.

**Where each verb reads it, stated per verb because they genuinely differ.** `github merge --admin` reads the
floor twice: once straight after the authoritative pull-request read and BEFORE the admin-rights and
branch-protection calls, so a failing branch costs no privileged read at all, and again immediately before the
merge. `github enqueue` cannot do the first half — the association needs the pull request's own head branch
and commit, so its read necessarily follows the pull-request, queue and required-context reads. On the
refusing path it therefore reads ONCE and refuses before the press; on the proceeding path it reads again
immediately before the mutation.

**For the landing floor the head commit, not the checkout path, is the repository identity.** A record is still
matched by its `repoRoot` inside `ledgerForBranch`, which is what `codex status` and `codex supersede` want —
both are questions about one checkout. The landing floor is not, and the path-reuse hole a Codex review
raised against it (delete a checkout, put a DIFFERENT repository at the same path, and its predecessor's plan
records still match) is closed rather than inherited: a checkout only speaks for a pull request when it holds
that pull request's head commit, and a different repository at a reused path holds no such commit. No stored
origin slug is needed, because git already knows the answer.

**Two subjects on one page read as one record, so the report names the other.** MEASURED: from the landing seat's
worktree, `codex status` printed six `NOT RUN` on a branch whose author's checkout held r1 and r2 BROKEN, while
`--check` from the same seat refused on them — and the run that read both concluded the gate read an empty record.
The table stays keyed by checkout, because its rows are judged against that checkout's working tree and another
worktree's rows would be marked against bytes they never read. What changed is that an empty table now says where
the branch's rows are: an `OTHER CHECKOUTS:` line counts every other checkout's rows through that checkout's own
fold (`src/codex/otherCheckoutPasses.ts`), printed only when this checkout holds none.

**A branch keeps the passes of the branch it continues, when git proves the link.** Every record names the branch
it was taken on, so a branch planned and reviewed under one name and pushed under another read as a branch nothing
ever ran on, and could land only past a `codex-loop-incomplete` acknowledgement. The landing floor, `codex status`
and the review cap now read the reflogs once (`src/codex/branchContinuityGit.ts`) and show a predecessor's rows
under the judged name in memory, never on disk (`src/codex/branchContinuityView.ts`). Two links count and nothing
else does: a `git branch -m` rename, in every checkout, and a `git checkout -b` cut from the checked-out branch, in
the checkout whose HEAD moved, and in none when two checkouts moved onto it in that second. A remote's default branch is never a predecessor, because a branch cut from the
shared base is new work and a plan taken there for other work would otherwise stand as its plan; a repository whose
remotes name no default carries nothing. A row counts only when it was made before the link and after the
predecessor's previous continuation, so two branches cut from one never share a pass, two cuts in one second take
nothing, and a later branch of the old name feeds nothing forward. A receipt this build cannot judge names no
instant, so a predecessor holding one carries nothing and the receipt is never relabelled. An expired reflog, a
checkout git no longer lists and a clone at another path prove nothing, so their rows stay on the name they were
recorded under, which is the old behaviour; a reflog, a worktree record or a remote HEAD that cannot be READ refuses instead,
because the cap must not under-count. Relabelling moves where a row is counted, never whether it
still describes the code: a review is `CURRENT` only by its tree, exactly as before
(`src/codex/branchContinuity.ts` carries the argument).

**A refusal names what it would land over.** The same run found two more silences, both in what a waiver says
rather than what it admits. `github merge --admin` printed only the reason line when it took a
`codex-loop-incomplete` acknowledgement, so a pull request merged over two BROKEN properties nothing on the page named; it
now prints every waived failure first, as `github enqueue` always did (`codexLoopFindingLines`,
`src/codex/landingGate.ts`). And "none is both current and conclusive" named only the newest drifted pass; it now
names every BROKEN review that went STALE or UNKNOWN with no later CLEAN under its property
(`src/codex/ledgerReviewHalf.ts`). Neither moves a verdict.

**The fan-out currency hole the floor ELEVATES, and how it is closed.** `codex review` captures ONE diff for a
fan-out. Capturing each pass's tree when that pass starts is wrong: before the plan floor, currency only meant "do
not cite this"; once a CURRENT review is a positive requirement, a queued property that started after a new commit
records a tree matching the NEW head while having reviewed the OLD diff — the gate's own requirement, satisfied by
a review that never saw the code being landed. Its mirror is noise in the same fan-out: properties that ran before
the commit record the older tree and read STALE, so one frozen diff produces rows of contradictory freshness over
identical bytes. Reproduced end to end against a real repository in
`src/__tests__/subprocess/codex/reviewProvenance.test.ts`, which reports `["stale", "current"]` against the
per-pass recorder and `["stale", "stale"]` against the fixed one.

The fix is a change of SUBJECT rather than a tighter check, and `src/codex/passProvenance.ts` is where the rule
lives — pure, and tested, rather than private to the effectful module that applies it.
`captureReviewDiffWithProvenance` brackets the diff read with one tree capture and every property records that
tree; `snapshotCommit` still names each property's OWN frozen copy, because the two fields say different true
things (what the verdict is about, and what the reviewer could see around it) and a reader can compare them.

**Why the obvious next check is still NOT added, and why the reason is not the dirty tree.** Folding the frozen
copy into a check on the recorded tree is the natural follow-up. Comparing `captureTreeFingerprint` cannot hold on
a dirty tree: it digests `(HEAD's tree object, the dirty patch)` while `createTreeSnapshot`'s worktree is a CLEAN
checkout of a commit whose own tree already contains that patch. MEASURED in a throwaway repository — clean, both
sides over one tree and EQUAL; one edit later, the live tree plus 175 dirty bytes against a different snapshot tree
plus 0, UNEQUAL by construction. On the PLAN arm that is not a limit but a defect: a third `stableTree` reading
that fires on every dirty checkout makes a plan pass from a dirty tree record no provenance, read `unknown`, and
never satisfy the plan floor's STALE requirement — which is nearly every plan pass, since the snapshot exists so
the agent keeps writing.

So that clause compares git's own CONTENT ADDRESS of both sides — `snapshotCommit`'s `write-tree` output, which it
already computes, against a `write-tree` of the live tree (`captureContentTree`, `src/codex/snapshot.ts`). It holds
dirty or clean, and it is strictly stronger on the one axis that looked like a loss: a scratch index built from
`read-tree HEAD` carries no skip-worktree bit, so it addresses content `git diff HEAD` does not report at all. So
the dirty-tree argument against the review-arm check does not hold. What survives is narrower and is not a
measurement: `tree` and `snapshotCommit` answer different questions by design, and a property that waited behind a
sibling legitimately read surrounding code from a later tree, so what a divergence there MEANS is a decision
rather than a check. That is its own row.

**The ledger ROW is what the floor guarantees.** A Codex review asked whether the door's persistence could swallow
a waiver silently. It cannot: `throughDoor` records the decision in `door_event` through
`src/admit/doorLedgerPort.ts` before it performs, and a write the store did not take is `recording-refused`, so
nothing is performed unrecorded. What the floor owes is that the reason reaches the row the door writes, which it
does.

**The reason is a filter against accident, never a proof of meaning.** `statesAReason` requires a letter or a
digit that is not default-ignorable, which is an INCLUSION rule because four successive exclusion lists were
each out-enumerated in turn (U+200B, then U+034F, then U+115F, then U+2800 BRAILLE PATTERN BLANK, each a
different Unicode category). A fifth review then defeated the inclusion rule too, with an ANSI escape whose
bytes contain a digit. That is the honest end of the road: no predicate decides whether prose is meaningful,
and the escalation only ever proves it again. What the filter buys is that a reason cannot be blank BY
ACCIDENT. An operator who works to defeat it is sabotaging their own audit trail, in a record that names them,
and no gate here pretends otherwise.

**"Immediately before" is not "atomically with", and the difference is stated rather than left to be found.**
Nothing locks the ledger, so a concurrent pass can still publish a `CURRENT BROKEN` record between the last
read and the mutation itself. Closing that needs a lock this repository does not have. Five separate Codex
reviews raised the window; the first two were real gaps and are closed, and the residue is written down here
instead of being claimed away.

## The escape is named, reason-bearing and recorded — and one thing was deliberately not built

Trivial work acknowledges `codex-loop-incomplete` with `--reason "…"`, which is written to the door ledger.
The owner capped review at two (not OK with a landing rate of about four a day against about eighty, and naming
seven review passes on one change), so a third pass is refused before it spends (`codex-review-pass-cap`), and
what still stands after the second is that same finding, landed with the same reason-bearing acknowledgement. The
PR description publishes no leftover, so the door ledger's reason is the one record, written by whoever chose to
land it.
`SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1` opens that refusal for one run of `codex review` or `codex review-fallback
prepare`: only on the owner's explicit steer for a third pass on one change, or for a ledger checked by hand as
corrupt, misattributed or short of two passes.
A baseline-bump witness is not a third pass: it counts in its own two-diff lane, admitted only as the exact
witness command with no hatch, and it never serves the pairing floor
([rebaseline and lanes](../toolchain/rebaseline-and-lanes.md)). Before the lane existed, a branch past its two
passes could not take the witness its own landing required.
MEASURED while building this: an `--acknowledge <subject>` that required no reason left no acknowledgement of any
kind in the ledger, so every waiver before the obligation is unattributable. The obligation applies to this subject
alone.

A reason-bearing `codex declare-trivial` verb was designed alongside this and NOT built. The acknowledgement
already carries the reason at the only moment it matters, and a second mechanism for one thing is how two of
them drift apart. Its absence is a decision; do not read it as an omission and add it later without a reason
the acknowledgement cannot serve.

## When Codex is CAPPED, Claude takes the review — as a receipt, never as a skip

When Codex hits its cap, a visible Claude session takes the review pass instead. A floor whose every review row is
a Codex pass record cannot express that: MEASURED, on the day the workspace spend cap landed, `codex status
--check`, `github enqueue` and `github merge --admin` all held a branch that had been through EIGHT review rounds —
the only ways past were the `unreviewed` hatch and a door acknowledgement, both of which describe reviewed work as
an exception. That is a canon defect: the rule says pair, Claude reviews when Codex cannot, and a gate that
accepts neither contradicts both.

**The mechanism is a RECEIPT, and the shape is the argument.** `codex review-fallback prepare` refuses
unless no registered Codex destination can take the pass right now, for a provider cap or the 99% routing
pause — or none is registered at all, below — then freezes exactly what a Codex pass would have read — the diff by digest and as a packet, the tree
it was cut from, the ONE property — beside the ground it saw. The
visible session answers the property in the review-output shape; `record` runs that answer through the same
validator a Codex response goes through, refuses if the tree moved since `prepare`, and writes the receipt
bound to the request's bytes by digest. `fallbackReviewEntries` (`src/codex/fallbackReview.ts`) folds a
receipt into the ledger as a review row with `provider: claude-code`, and `loopFailures` judges it by the
rules it already had: CURRENT or nothing, CLEAN or BROKEN, and a current `BROKEN` from EITHER brain vetoes.

Three things the shape refuses, each because the alternative was reachable:

- **A bare `if (capped) return []`** would make the cap itself satisfy the floor, so a capped account lands
  unreviewed code with nothing on the record. A cap alone still refuses; the refusal NAMES the fallback
  verbs as the way through, which is the whole difference for a session reading it.
- **Forging a `CodexArtifactRecord`** for work Codex never did would put invented token usage in a ledger
  `codex usage` reads, and hide which brain read the diff. The receipt is a separate document in separate
  store tables (`codex_fallback_request`, `codex_fallback_receipt`), and the row prints `[claude-code]`.
- **Letting a review receipt stand in for the PLAN** would put a post-hoc document where an order proof
  belongs: a plan reads the tree BEFORE the work, so nothing written at landing time can be one, and a cap
  before any planning pass establishes nothing about planning. A review receipt is review evidence only.

**But a cap never HOLDS a landing on the plan half.** If Codex is unavailable, Claude does the work instead of
holding everything up: Codex is preferred, but once the limit is hit nothing should stop, and nobody should wake up
to a pile of work that did not land because it was waiting on Codex. A branch started under a cap therefore never
holds on the plan half: work already begun with no plan rides the `codex-loop-incomplete` acknowledgement, whose
reason is written to the door ledger — MEASURED, 89 stood there at one count
(`grep -c '"subject":"codex-loop-incomplete"' $SLOPWEAVER_HOME/ledgers/door.jsonl`). **That count mixes two
populations** and a reader comparing it to the figure above has to say which: a chair's hand-typed reason, and
the ONE constant reason `github landing --press` writes when a standing human approval covers a pull request of
the owner's (`PRESS_CODEX_WAIVER_REASON`, `src/review/reviewSignals.ts`). Grep the constant to split them; the
capped-plan population is the one WITHOUT it. A press that waives the superseded rollup in the same click joins
both sentences into the one `--reason`, so the constant is a SUBSTRING of that row rather than the whole of it —
a substring grep still splits the populations, an equality test does not.

**The plan half has a receipt too, and it is taken BEFORE the work.** An acknowledgement lets a landing
through without manufacturing a plan, so gold on every capped landing is unearnable by construction: MEASURED,
38 landings rode it in one capped stretch of under a day, with one gold-owed row on the board between them. So
the plan half gets a visible Claude substitute run before the work while capped.
`codex plan-fallback prepare` freezes the exact prompt `codex plan` would send and the tree; `record` validates
the answer as a Codex plan response and REFUSES once the tree has moved, so the plan is on the record before
the first edit and the work turns the row STALE — the rule `loopFailures` already applies. What it gives up,
stated: the planner is the model that then writes the code, so it catches less than an independent brain.
The order property is kept. `cappedPlanNextStep` (`src/codex/ledgerCapClauses.ts`) names this verb first and the
acknowledgement only for work begun unplanned; a `BLOCKED` plan from either brain is never ridden past. Codex is
preferred, so the moment the cap lifts the plan goes back to Codex; nothing here retires it.

**Cap evidence is captured at preparation time, and quota recovery does not erase a completed fallback.** The
review happened over this diff; that is what the floor asks. Conversely, an unreadable gauge is NOT a cap —
`prepare` refuses on it, with `SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED=1` as the hatch for the one honest
exception, a pass that just failed FATAL on a cap Codex has not yet written to its own log. A receipt that
will not parse, or whose request bytes were edited after recording, is counted as UNREADABLE by
`incompleteScanReason` and fails the landing closed, exactly as an unparseable pass record does.

**An install with no Codex plan registered takes both passes in Claude — on its own ground, never a cap.**
Every ground above is a statement about Codex CAPACITY, so on a Claude-only install a fallback verb that knew only
caps would refuse and rule 9 would have no route at all. The constraint on the fix: no Codex plan is a legitimate
reason to take the pass in Claude, and NOT evidence that Codex was capped. So it applies
only to a readable register with zero Codex rows, adopted or derived (`src/codex/providerUnregistered.ts`) — a
Codex plan exists only once the user registers one, never from a login found on the machine, and a paused or
signed-out row is a Codex plan, merely unavailable —
and it records its own `ground`, folds as `fallbackGround: codex-provider-unregistered`, and is never read by
`cappedPlanNextStep` as a cap witness. Its requests declare their OWN modes (`plan-codex-provider-unregistered`,
`review-codex-provider-unregistered`) rather than reusing `plan` or the review default, because the store is
shared and append-only: an older build that could not PARSE a reused mode would count the row unreadable and
fail every landing gate on the machine closed, while a mode it has no parser for is FOREIGN to it.

FOREIGN is not harmless, and a Codex pre-mortem found why: those modes ARE a plan and a review, so an older build
that skips them could pass a branch on an older READY or CLEAN row while a newer BLOCKED plan or BROKEN review
stood beside it. Two mechanisms close it. **Going forward**, an ANSWERED foreign request naming the checkout and
branch being judged refuses that one branch (`src/codex/scanReasons.ts`'s `foreignReceiptScanReason`, in the
landing floor, `codex status --check` and `codex supersede`), never the install. **For builds already deployed**,
which cannot learn that rule, there is a store migration — the request row's `reader_epoch`
(`src/store/schema/codexFallback.ts` § "The reader epoch"): once applied, an older build reads the database as
foreign and `connectStore` refuses until that checkout is updated, and no build can write one of these modes
before it is applied. The residue is named: `SLOPWEAVER_ALLOW_STALE_STORE=1` opens that fence on purpose.

**The provider field is an attestation, not a proof.** Nothing establishes that a model rather than a hand
wrote the answer — and nothing in the Codex path establishes that either. What the shape guarantees is that a
fallback review is exactly as visible and exactly as checkable as a Codex one: a request, an answer validated
against the property, a tree it is bound to, and a row a reader can see.

## The blast radius, measured rather than estimated

MEASURED across the 137 branches holding pass records in one install: 46 carry both a plan and a review, 36 carry a
review only, 55 a plan only. So the plan half newly reddens 36 branches, nearly all long landed. No grace period
and no backfill exist — the acknowledgement is the migration path, and a grace window would be a second mechanism
with an expiry date nobody would remember to remove.
