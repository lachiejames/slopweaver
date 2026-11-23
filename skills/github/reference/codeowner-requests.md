# A pending code-owner REQUEST is not a REQUIREMENT

Bundled reference for the `github` skill. Read it when a row reads `awaiting-human-review`, when `github
enqueue` refuses `review-not-approved`, or before changing what `codeowners-satisfied` decides on.

**The case that motivated it:** one `acme/acme-admin` bump with three approvals, every check passed,
no conflicts, GitHub itself offering **Merge when ready** — while the landing read held it and the
other bump pull requests as waiting. The one field they all had in common was an open `asCodeOwner` request.

## The criterion

GitHub holds a request out on a pull request whose branch protection is ALREADY satisfied, and offers the
queue button on it at the same time. So an open request is read together with GitHub's own
`mergeStateStatus`:

| `mergeStateStatus`                    | what it may be read as                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| `CLEAN`, `UNSTABLE`, `HAS_HOOKS`      | GitHub would merge this now — the open request PASSES         |
| `BLOCKED`                             | something is holding it; the request is treated as that thing |
| `BEHIND`, `DIRTY`, `DRAFT`, `UNKNOWN` | settles nothing about review — the request holds              |
| absent, null, or a token not above    | `unread` — the request holds, and the read says what it found |

**The positive set is three tokens rather than "anything except `BLOCKED`"** because GitHub documents no
precedence among simultaneous blockers: a `BEHIND` pull request that ALSO needs a code owner answers
`BEHIND`, so reading it as "not blocked, therefore review is satisfied" would be a guess. The direction that
costs a row is a hold; the direction that costs a wrong merge is a press, and only the three positive tokens
are GitHub saying it would press the button itself.

**`unread` is its own arm rather than a fallback.** A dropped query selection, a null, or a token this
repository has not seen leaves the field unclassified — and silence reading as green would decide a
code-owner exception on nothing at all. So it holds and names what it found.

## The one predicate, asked by both sides

`pendingCodeownerRequestIsNonBlocking` (`src/review/githubMergeStatus.ts`) is the whole rule, asked by the
fleet read (`src/review/landingTests.ts` — `blockedOn` and `codeowners-satisfied`) and by the enqueue door
(`src/cli/commands/github/enqueueReviewFinding.ts` — the `review-not-approved` finding). Two copies of a criterion
this narrow is how a read plans an act the write refuses, nine times a pass
([backlog.md](backlog.md) § A `bot-author` bump keeps `codeowners-satisfied`).

**The door still re-asks GitHub itself**, through its own `PR_QUERY` rather than through the fleet's read, so
a fleet `CLEAN` and a door `BLOCKED` can disagree and the door's own read is what governs the write. Be exact
about how far that goes: `githubMergeStatus` is read only inside `absentDecisionFinding`, so a door
`BLOCKED` raises `review-not-approved` only where the decision is absent and the request read is complete —
over a pending request where `requiresCodeOwnerReviews` is not `false`, over an empty register once CI raised
nothing (§ What the exception does NOT touch). Outside that path nothing in the door refuses on the status
alone — `not-mergeable` reads `mergeable`, a different field, and answers `MERGEABLE` on a `BLOCKED` row. The
provider mutation and its read-back stay the final authority; nothing here acknowledges a finding on its own
behalf.

**One place they diverge, independent of this exception.** The door has a
`requiresCodeOwnerReviews === false` guard the fleet read has no equivalent of, so on a base carrying no
code-owner requirement `github landing` can read `waiting on a human review` over a pull request
`github enqueue` would press. The direction is the safe one: the read UNDER-reports what is pressable, and
the door still never refuses what the read planned.

**That guard is narrower than it looks, and the distinction matters.** It sits INSIDE
`absentDecisionFinding`, which `reviewFinding` reaches only for an ABSENT decision. So on a base whose setting
reads `false`, a stated non-`APPROVED` decision still raises `review-not-approved` from the branch above it,
and an absent decision over a capped request page still raises one from the truncation guard above it. What
the setting releases is the narrow case of an absent decision over a COMPLETE read naming a pending owner. An `APPROVED` decision
short-circuits all three, capped page included, which is the second divergence below rather than this one.

**Closing it is one adapter field, not a new network call** — worth knowing before anyone prices it. The
fleet ALREADY asks branch protection per base: `readRequiredSets` (`src/cli/commands/github/reviewStateRun.ts`)
issues `branchProtection.ts`'s `PROTECTION_QUERY`, which selects
`branchProtectionRule { requiredStatusCheckContexts requiresCodeOwnerReviews }`, and the adapter at
`reviewStateRun.ts`'s `requiredContexts` returns `answered.value.contexts` alone, throwing the code-owner
setting away (call path walked by a Codex pass). Carrying the field through RELEASES
rows the read holds today, which is the direction that wants its own change rather than a rider on this one.

## A leftover request to a person

The second release needs no merge status, which is the case the table above cannot reach: one `acme/acme-admin`
pull request read `mergeStateStatus` null and `reviewDecision` null while GitHub recorded an approval on behalf of
all three codeowner teams and still held an `asCodeOwner` request to a person who owns no CODEOWNERS rule — a
team's review assignment had routed the team request to that person. A chase DMed them for "the last codeowner
tick"; the pull request was waiting only on unresolved threads and a stale branch.

`pendingCodeowners` (`src/review/requiredCodeowners.ts`) splits GitHub's pending owners. A pending PERSON is a
leftover only when every invoked rule is satisfied (`src/review/codeownerRules.ts`, which reads `onBehalfOf`
team approvals), that person owns none of them, no team is pending, both the request list and the changed-path list were
read whole, the base is the default branch (whose CODEOWNERS the rules come off), and `reviewDecision` is empty or
`APPROVED`. `blockedOn` and `codeowners-satisfied` read the split, so no chase, dispatch or suggestion names a
leftover. A team is never one.

**The door does not share this release.** `github enqueue` still raises `review-not-approved` on a `BLOCKED`
status over an absent decision, so where the read plans a press over a leftover and GitHub still blocks, the
write refuses: the read over-reports what is pressable, and the door governs the write.

## What the exception does NOT touch

- **A stated review decision.** `CLEAN` can never overrule a decision GitHub stated in words, so any
  non-empty `reviewDecision` keeps the exception shut and the pending request goes on holding the row. The
  read reaches that through the predicate's third input; the door reaches it earlier and differently, at its
  own `reviewFinding`, which returns on `APPROVED` and raises a finding on everything else. **So the two
  sides agree on `REVIEW_REQUIRED` and `CHANGES_REQUESTED` and DIVERGE on `APPROVED`** — the door treats it
  as satisfied, the read still holds for the pending owner. That is the safe direction and it is the same
  shape as the `requiresCodeOwnerReviews` divergence above: the read under-reports what is pressable. All of
  this was found by Codex review passes, the first off a `CLEAN` plus `CHANGES_REQUESTED`
  pull request the read passed and the door refused.
- **An INCOMPLETE request read**, which is two things and not one. A capped request page can only ever LOSE
  a pending owner, so the register this is arguing about is not fully known. So can a DROPPED entry: GitHub
  declares `requestedReviewer` nullable while `asCodeOwner` is `Boolean!`, so a deleted or invisible reviewer
  arrives flagged and unnamed, `parseReviewRequests` drops it, and the register reads EMPTY (found by a Codex
  pass). `reviewRequestsTruncated` answers BOTH, so `requestsTruncated` holds whatever the status says. Relaxing incomplete evidence is a second
  policy change and this is not it.
- **An EMPTY request register over a STATED decision.** GitHub retires a request the moment its reviewer
  acts, so a code owner who answered `CHANGES_REQUESTED` leaves nothing behind and the register reads clean.
  So the arm fails for any stated decision other than `APPROVED`.
- **An EMPTY request register, NO decision, and a `BLOCKED` merge.** A review a ruleset requires leaves
  `reviewDecision` null, so the absence says nothing there: one `acme-admin` pull request read `BLOCKED`, null,
  no request and nobody approved, and all six tests passed it to `press`.
  `blockedWithoutReviewDecision` (`src/review/githubMergeStatus.ts`) is the shared condition. A running or red
  required check blocks the same way, so CI decides which hold it is: once `ci-green` passes the read FAILS
  `waiting on a human review` naming nobody, and before that it is `unknown` and CI stays the action. The door
  raises `review-not-approved` on the same shape once CI raised no finding, and `requiresCodeOwnerReviews:
false` does not clear it — that classic setting cannot see a ruleset.
- **An EMPTY request register, NO decision, and a status that is not `mergeable`.** `BEHIND`, `DIRTY`, `DRAFT`,
  `UNKNOWN` or an unread status reads `unknown`, never `pass`: GitHub documents no precedence among blockers, so
  only the three mergeable tokens prove the base holds nothing. Measured: the same heads read
  `BLOCKED` and were held, then read `UNKNOWN` (GitHub recomputing), passed, were pressed, and the door's fresh
  read found `BLOCKED` and refused each. An absent decision passes only over `CLEAN`, `UNSTABLE` or
  `HAS_HOOKS`, which is every settled row on a base requiring no review, and every pass names the status or
  `APPROVED` it rested on, so a stored reading shows which input flipped.
  One residue survives, named rather than claimed shut: `githubCodeownerRequirement` builds owners from
  APPROVED reviews and OPEN requests only, so a code owner who answered `CHANGES_REQUESTED` `onBehalfOf` a
  team, whose request GitHub then retired, is invisible to this test if the aggregate decision ALSO reads
  null. Every path to that needs GitHub to contradict itself, and reshaping the requirement builder is a
  change of its own.
- **The other five landing tests.** Red CI, a missing required context, an unresolved reviewer thread, a
  draft and an unmergeable branch all still refuse the LANDING READ. The door is a different finding set, not
  a copy of this one — it reads no reviewer threads at all, so a thread waiting on the author fails
  `threads-clear` here and raises nothing there. That gap predates this change and is not what the exception
  touches.
- **The six-words rule.** It governs whether a FIRST ask is SENT, never whether a satisfied pull request is
  enqueued; those are different acts and always were ([review-state.md](review-state.md)).
- **Who makes the first ask.** A pending code owner nobody was ever asked dispatches `draft-first-review-ask`:
  a seat drafts the ask to a named person, or a discussion opener where no discussion agreed the change and it
  is no obvious bug, and parks it with `slack draft record`, and nothing sends it
  without the owner's yes ([dispatch.md](dispatch.md)).

## What was measured

MEASURED over eleven pressed by hand. **Ten** answered `BLOCKED` — every open
`acme-admin` bump — so `awaiting-human-review` was the right verdict on them and the original framing was broader
than its facts. **One**, on base `staging`, was mis-read: the door took it under a
`codex-loop-incomplete` acknowledgement and GitHub merged it minutes later. Reproduce the read with:

```bash
github landing --repo acme/acme-admin --author @me --json
github enqueue --pr <n> --repo acme/acme-admin --dry-run
```

That pull request answers `UNKNOWN` now that it is merged, so it cannot serve as a live positive witness; the frozen
witness is `src/__tests__/unit/review/githubMergeStatus.test.ts` and the ladder pair in
`src/__tests__/unit/review/landingDispatch.test.ts`, which differ in `mergeStateStatus` alone.
