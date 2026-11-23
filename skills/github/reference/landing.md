# One command every tick: `github landing`

Bundled reference for the `github` skill, loaded when a row has to be trusted, extended or disputed. GitHub's
own open count rides beside the rows as `census`, never a row: [landing-census.md](landing-census.md).

`slopweaver github landing` breaks every open pull request a selection matches into **ONE next act**, so a
supervisor tick presses, registers or waits without inferring anything. Read-only without `--press`/`--register`.

```bash
github landing --author @me                                                         # one fact line per PR: the owner's; no --repo = `org show`'s repositories + this build's, ORG_NOT_CONFIGURED with none
github landing --repo <owner/name> --author <login> --full                          # the wide table, every residue line
github landing --repo <owner/name> --author <login> --pr <n>                        # ONE PR whole: failing test files, added or not
github landing --repo <owner/name> --author <login> --json                          # machine-readable, each row's `facts` included
github landing --author @me --if-due --press --register --record-reading tick-<n>   # the TICK invocation; --record-reading also appends each new ask to the reviewer register (reviewers.md)
github landing --author @me --if-due --drafts-only --register                       # the tick's DRAFTS reading: the owner's drafts only, boarded, never pressed
github landing --repo <owner/name> --author <login> --press --dry-run               # what it WOULD queue
github landing --repo <owner/name> --author <login> --press                         # queue them: the owner's and bumps all, others 3/repo
github landing --repo <owner/name> --author <login> --slack-live                    # + the live Slack leg
```

**The default names each row's blocker in one line, and disclosure is by flag, never a dump**: the failing check
(required or advisory), CodeRabbit, who approved, the code owners by state, the threads awaiting us and the ask
— grouped under its verdict, the residue folded to one line. Format and the `--pr` drill-down: [landing-output.md](landing-output.md).

**`@me` is GitHub's own token-relative author**; a literal login works, but only `@me` may `--record-reading`.
**`--if-due` rations the read by a register, `--register` boards every dispatchable row for the fill step and
settles `answered` an unattended one whose pull request ENDED, merge commit as witness; drafts are a reading of their own**: [landing-cadence.md](landing-cadence.md).

## The six tests, and why every one is GitHub's own fact

A row is `ready` only when all six pass. `unknown` is a first-class answer and never produces a press.

| Test                   | What decides it                                                                  |
| ---------------------- | -------------------------------------------------------------------------------- |
| `undrafted`            | `isDraft`                                                                        |
| `ci-green`             | the rollup **and** every context the base branch REQUIRES                        |
| `mergeable`            | GitHub's `mergeable` — three-valued, `UNKNOWN` is not a pass                     |
| `threads-clear`        | `waitingOn` — reviewer threads only, never the owner's own                       |
| `codeowners-satisfied` | GitHub's `asCodeOwner` requests, its `onBehalfOf` reviews and `mergeStateStatus` |
| `queue-available`      | base is the default branch AND that branch has a queue                           |

**`ci-green` folds in the required set because the rollup cannot see a context that never ran**, the required
SET is read per BASE while the judgement is per HEAD, and the mergeability the gate carries is the settled
one. Conflating the first two called 18 of 23 rows unlandable — [required-contexts.md](required-contexts.md).

**A head with more checks than one page is re-read WHOLE before it is judged, never parked on `unknown`** — the
one page every caller shares, and the standing-ordered bumps that sat unpressed behind it:
[check-page.md](check-page.md).

**An out-of-date branch is NOT a hold.** The queue rebases on a throwaway ref, so behind-ness is a
`rebase-and-fix` at most and never a wait ([merge-queue.md](merge-queue.md)); 0 of those same 27 rows read
`no-queue`, so on every base in the fleet that is what it means. A seat treating GitHub's direct-merge
up-to-date precondition as a landing precondition is reading the wrong button — and one sat four hours on
that reading plus its own unresolved walkthrough threads ([self-review.md](self-review.md)).

**`threads-clear` uses `waitingOn`, not a count of unresolved threads** — it excludes the author's own
one-voice `--self-review` notes, and counts the colleague who replied to one
([pr-state-detail.md](pr-state-detail.md)). A capped thread read can only LOSE an unresolved thread, so
truncation is `unknown` rather than a green.

**`codeowners-satisfied` reads GITHUB's answer, never the derived CODEOWNERS reading**, and a pending REQUEST
is not a REQUIREMENT — GitHub's `mergeStateStatus` says which ([codeowner-requests.md](codeowner-requests.md)).
It fails as **"waiting on a human review"**; an ordinary request is never a chase.

**`mergeable` has THREE answers, and a first read is the one most likely to miss.** `UNKNOWN` answers the
test `unknown` and the fleet read re-reads what came back unknown once — the two measurements, and why a cold
read is where the misses land, are [mergeability.md](mergeability.md).

**CodeRabbit is not one of the six**, and `stale` never demotes `press`: pressable pull requests have read `stale`.
A `changes-requested` CodeRabbit becomes
the ACT `spawn-coderabbit`: a failing CodeRabbit gets a spawned session to address it. A `stuck` one `--press` re-requests first ([coderabbit-nudge.md](coderabbit-nudge.md)).
That is about LANDING; CodeRabbit still never gates a review ask ([review-state.md](review-state.md)).

## The measurement this closes, stated as the criterion rather than a count

MEASURED on `acme/acme-admin`: `github enqueue` reported `clean` on
**most** of the owner's open pull requests and only **a handful** were ready. Reproduce it
with `github review-state --repo acme/acme-admin --author <login> --json`.

The cause was that **GitHub's aggregate `reviewDecision` is null on that repository** and `enqueue`'s
approval check treated an absent decision as satisfied — measured: `reviewDecision: null` beside an
open `asCodeOwner: true` request out to a team, with the dry run still printing _"clean: nothing stands
between this pull request and its base branch's merge queue"_. So the test reads GitHub's own flags, and
`github enqueue` falls back to the same flags when `reviewDecision` is absent ([merge-queue.md](merge-queue.md)).
Why the DERIVED codeowner answer cannot replace it, and the one limit both share — a satisfied INDIVIDUAL
owner leaves nothing behind, so the read is conservative in the safe direction and says so as residue on
every row — is [github-codeowners.md](github-codeowners.md).

## The acts, in the order the ladder decides them

`opted-out` · `draft` · `conflicting` · `spawn-ci` · `spawn-coderabbit` · `stacked` / `no-queue` ·
`answer-threads` · `blocked-on` · `pressed-not-queued` · `queued` · `unknown` · `press`.

The order is the owner's, not a taxonomy: an opt-out beats everything because it is a human saying "not this one"; a
draft cannot land until it is finished and undrafted, and a conflict must be resolved before any other act can
land; then the two the owner named as spawns, CI first because a red build makes CodeRabbit's review moot; then a
stack or a missing queue; then the two waits, our own thread answer before somebody else's tick.

**`spawn-ci` and `spawn-coderabbit` deliberately outrank `stacked`**: either is work a session can start this
minute, which landing the bottom of the stack cannot do. The rule is about
ASKS: a stacked row still gets none, and a GREEN stacked row with nothing outstanding still reads `stacked`.

**An advisory-only red holds nothing** (`src/review/gatingChecks.ts`, shared with `enqueue`).
`ciFailure` prints `REQUIRED`, `advisory` or `RED?`; `dev-gate` counts as required, an empty required set proves nothing,
and a whole read, every failure advisory, passes `ci-green` to its real hold or `press`. Waits: [human-wait.md](human-wait.md).

## What the press does, and the two guards it carries

**Two guards the dispatch layer puts on the write, and what `--press --json` emits**: [dispatch.md](dispatch.md).

`--press` **does not reimplement the click.** It calls `github enqueue` in process, once per pressable row, so
the whole shipped guard applies — the merge hold, every finding, the door record and the `mergeQueueEntry`
read-back. If `enqueue` refuses, the row reports `failed` with `enqueue`'s own findings printed above it.

- **The opt-out label.** `no-auto-merge` by default, `--opt-out-label <name,...>` to change it, compared
  lower-cased. Sometimes a green pull request is open to start an argument, not to
  land. It is a GitHub label because that is the only control a human can attach without this machine, and it
  exists BEFORE the first press rather than after the first surprise.
- **The head is re-read immediately before each press, and the remaining window is stated rather than
  implied.** A press names a pull request by NUMBER, and a head can move between the read that judged it and
  the click. Immediately before each press — one small request per row, never one for the set — the current head
  is re-read, and a row whose head has moved, or whose head could not be re-read at all, is reported `failed`
  and left alone. Per row rather than once for the set, because an earlier press takes time and a later row's
  head can move inside that window. What this REMOVES is the long window between the fleet read and the
  press; it cannot remove the last moments before the click, and closing that needs `github enqueue` to
  accept an expected head — a change to that verb's contract and a named follow-up. `enqueue`'s own fresh
  read and guard set stand behind it. Without it a row judged green at one commit could
  queue a different one whose tests were never computed, which a Codex review built as a concrete sequence.
- **The press read-back.** The queue tests a branch merged with current base, which the pull request's own CI
  never built, so an entry can be dropped minutes after it is taken — one was enqueued and read `entry: not queued` forty minutes later, and nothing noticed. A press is recorded in the store's
  `landing_press` table, append-only under an idempotency key, **with its subject and the head this READ judged** — which is what
  the later eviction test compares against, and is not a claim about the commit `github enqueue` finally
  pinned its own mutation to: `enqueue` takes a fresh read of its own, so in the last moments before the click
  the two can differ — recorded on
  `enqueue` exiting zero, which it also does when it finds the pull request already queued, so a row here
  means "this machine's press call was accepted" rather than strictly "this machine took the entry"; a later read
  that finds no entry at that same head reports `pressed-not-queued` and never presses again until the head
  moves. **The act is named for what was OBSERVED, never for a cause** — a hand-run `--dequeue` produces the
  identical state, and the absence establishes neither. The register is machine-local, so another machine
  reads the same pull request as `not-queued`.

**Why a register at all:** the door ledger records every enqueue — 280 at one count — and by explicit design
stores _"never a target id and never a word of content"_, so it proves an enqueue happened and can never say
which pull request it was. A press this machine makes on the owner's behalf needs a register that names its subject.

**A key its own fields do not hash to** (a carry rewrote a slug) refuses the whole register; the reader stays strict.
`github press-reseal --repo <owner/name>` previews the re-key, and the apply line it prints re-keys in one transaction.

**Every row of the owner's and every bump is pressed in ONE invocation**; anybody else's is capped at **three per
repository**, in the verb, so a wide `--repo` is never a wave over a colleague's work ([why](../../../docs/doctrine-rationale/rule-1.md#the-press-cap-that-made-the-owners-word-wait)).
One bound covers every row: **no press STARTS 150s after the first** (`PRESS_PASS_BUDGET_MS`); a row left
reads `failed`, `not pressed`, for the next pass, since the tick kills a read at 300s and a killed read says nothing.

## The DISPATCH verdict — what the supervisor DOES about the row

A boot read must carry enough that the supervisor dispatches the obvious act itself and only
interrupts the owner for the one it cannot: the right information in front of the supervisor, and good judgment.
So every row carries a second, coarser answer above its `ACT`. This is
`AGENTS.md` rule 10 with the judgement already computed: card
only the owner's judgement calls, and take every other act.

| verdict                  | the supervisor                                                                                                                                                               | what reaches it                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `rebase-and-fix`         | spawns a session                                                                                                                                                             | `spawn-ci`, or any measured conflict — the seat resolves named paths and cards the owner only a MATERIAL change, naming it |
| `merge-now`              | presses, or spawns a landing session                                                                                                                                         | `press`                                                                                                                    |
| `resolve-then-merge`     | spawns a session                                                                                                                                                             | our own open threads, nothing else waiting                                                                                 |
| `resolve-then-bump`      | spawns a session                                                                                                                                                             | our own threads plus a code owner, or a code owner with a chase DUE                                                        |
| `coderabbit-loop`        | spawns a session                                                                                                                                                             | `spawn-coderabbit`, or only a bot waiting                                                                                  |
| `needs-owner-judgment`   | **cards it HIGH on react-now, dispatching nothing**                                                                                                                          | a reviewer spoke last, or a standing `CHANGES_REQUESTED` — never a merge conflict ([dispatch.md](dispatch.md))             |
| `draft-first-review-ask` | spawns a session that drafts the ask, or a discussion opener when no discussion agreed it and it is no obvious bug, and PARKS it with `slack draft record`, never sending it | `blocked-on` with nobody ever asked, or a human thread plus a pending code owner nobody asked                              |
| `finish-or-card-close`   | spawns a session that finishes it unasked, or records a shaped close card, never closing it                                                                                  | a draft no live board row holds — one a live row holds is `waiting`, naming it                                             |

A row with nothing for a session to do reads `waiting`, `outside-the-set` or `unread` — which one is itself
information — so no row is force-fitted; the last two verdicts are why nothing the owner owns goes stale. **Its
escalation signals are STRUCTURAL, never a claim of "pushback"** — what a reply MEANS is the owner's to read. The ladder,
the terminal evidence gate, the tallies, the behind-base read and the Slack bound: [dispatch.md](dispatch.md).

## What it cannot answer

- **A satisfied individual code owner**, above — the one blind spot, and it errs toward holding back.
- **Whether a chase was actually SENT.** The Slack legs find ask-LIKE messages and `cadence.ts` says whether
  one is due; no field distinguishes a first ask from a bump. A row says "an ask-like message was found",
  never "a bump was sent". MEASURED over 30 pull requests with the corpus 10 hours behind: the
  corpus leg alone answered `asked: yes` on 15 and `bump: due` on 1, and `--slack-live` answered 27 and 9.
  **`--slack-live` needs a Slack user token.** With none, production hands the read no search seam, the leg is
  skipped, and the run says so in its residue — it never reads as though the live leg ran.
- **Whether a merge-queue run will pass.** The queue tests your branch merged with current base; nothing here
  can predict that, which is exactly why the eviction read-back exists instead.
- **Whether an approval is stale against a newer head.** GitHub does not reissue a code-owner request on a
  later push unless the branch dismisses stale reviews, and that setting is unread.
- **A pull request with more review threads than one page can never read `press`**, even with every thread
  resolved: a capped thread read can only LOSE an unresolved one, so `threads-clear` is permanently
  `unknown`. Rare — the busiest measured had 59 against a page of 100 — and the escape is `github enqueue`
  by hand, which applies its own guard.
- **Whether a base enforces code-owner review, or an `asCodeOwner` request is MANDATORY, under a ruleset.**
  `requiresCodeOwnerReviews` is read off classic protection only; a RULESET states it under a rule type the read
  does not parse, so it answers `undefined`, treated as not-ruled-out rather than as no requirement.
- **Whether a board row exists.** The join is a STATED branch only — a declared `branch:`, or the one its run
  recorded at `handover start` (an ask row's seat); a name match is the fuzzy matching this repo forbids. So
  `none?` means no row STATED this branch, which is not the same claim as no row existing.
