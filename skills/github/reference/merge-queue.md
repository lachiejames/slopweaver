# GitHub's native merge queue — `github enqueue`

`slopweaver github enqueue` presses the same **Merge when ready** button a human clicks on a pull request
whose base branch has a native merge queue. It hands the landing to GitHub, which merges the pull request
once the queue's own required checks pass on the MERGED result rather than on the branch alone.

**On a queued base it is THE landing verb**, not the hand-run hold-and-baton lane. `lachiejames/slopweaver`
`main` is not one: a native merge queue is an organisation-repository feature and this is a personal repository,
so its `main` lands through `github lap --land` while hosted CI is off ([local-lap.md](local-lap.md)), else
`merge --admin`. Why, with the measurement: [pull-requests.md](pull-requests.md).

## Enqueue DIRECTLY — no seat, no wave, and no rebase for a mergeable pull request

**The queue tests the MERGED tip, so a pull request whose base has moved is still a legitimate entry.**
GitHub builds `refs/heads/gh-readonly-queue/main/pr-<n>-<sha>` from the base tip plus every entry ahead of
this one plus this one (below) — which IS the rebase, performed by GitHub on a throwaway ref. So rebasing a
mergeable pull request before queueing it buys nothing the queue is not already about to do, and an
out-of-date branch is not among the refusals below. **Rebase only when GitHub itself says so** — `mergeable`
reads `CONFLICTING`, or the queue kicked the entry back out. (A queue MAY be configured to require branches
up to date, in which case an out-of-date entry is rejected on entry rather than merged; no verb here reads
that setting, so treat a rejection at `enqueue` as the signal rather than rebasing on spec.)

So there is **no seat and no wave**. A green, gold-anchored, mergeable pull request goes to `enqueue` the
moment it is ready, however many are already in the queue; GitHub owns the ordering and a session that dies
after queueing stalls nobody. Measured, which is why this section exists: a supervisor released
a parked fleet three at a time — each turn a rebase, a local `yarn validate`, a push and a wait for a fresh
green — and ten already-green pull request sessions sat idle for hours behind that self-imposed lane.

**The full lap is CI's, never a seat's.** The `pre-push` hook runs only the five gates
CI cannot see the subject of (`yarn validate:local`, 43.5 s; everything else is CI's —
[toolchain/rebaseline-and-lanes.md](../../../docs/toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) § Two lanes),
and `whole-tree-check-guard` refuses `yarn validate`, `yarn lint` and `yarn typecheck` in an agent session. A
pull request's proof about the code is CI's `build`, read with `slopweaver github checks --wait`; the files you
touched are tested and type-checked locally, and nothing is re-run to earn a place in a queue. **The one
exception is a repository whose hosted Actions is off**: nothing posts `build` there, the queue never moves,
and `github lap` runs the whole lap as one verb and lands through the administrator bypass instead —
[local-lap.md](local-lap.md).

It is one of three landing verbs and does a different thing from each of the others:

| verb                    | what it does                                                           |
| ----------------------- | ---------------------------------------------------------------------- |
| `github merge --admin`  | squash-merges NOW through the administrator's branch-protection bypass |
| `github hold`/`release` | governs slopweaver's OWN advisory lane; reaches no repository at all   |
| `github enqueue`        | puts the pull request in GitHub's native queue and lets GitHub land it |

**Different is not independent: a standing `hold` REFUSES this verb**, before the token and before any
read, exactly as it refuses `github merge`. `--dequeue` is exempt. A hold on a queued base is the narrow
surviving exception rather than the lane — [merge-hold.md](merge-hold.md) carries the scope, and the
measurement of a hold that guarded nothing because this gate was missing.

## A queue entry is tested on its OWN ref, so CI must run on `merge_group`

The queue does not re-run the pull request's checks. It builds a throwaway branch —
`refs/heads/gh-readonly-queue/main/pr-<n>-<sha>`, the base tip plus every entry ahead of this one plus this
one — and fires the **`merge_group`** event on it. Nothing else fires. A workflow without that trigger
therefore produces **no check at all** on an entry, and a required check that can never arrive does not fail
the entry: the queue simply stalls. `.github/workflows/ci.yml` carries the trigger for exactly this reason.

Two jobs run on `merge_group` and one deliberately does not:

| job           | on `merge_group` | why                                                                                                                                                                  |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`       | yes              | the required verdict of every worker job in `build.needs` (the six unit shards among them), which run on `merge_group` too — meaningful on the merged result         |
| `integration` | yes              | runs the committed integration suites offline and reads nothing from the pull request                                                                                |
| `dev-gate`    | **no**           | its subject is the pull request BODY, and a `merge_group` event carries no pull request — it gates the PR instead, from its own `.github/workflows/pr-body-gate.yml` |

**So the queue's required checks are `build` and `integration`, never `dev-gate`.** Requiring `dev-gate`
would stall every entry on a check that structurally cannot run. The `unit` job's coverage floor reads
`github.event.merge_group.base_sha` on this event, because `github.event.before` names nothing on a queue ref.

**That claim is MEASURED rather than reasoned, and it covers code scanning too.** `github
required-contexts` reads what actually ran on recent entries, and on `main`, over eight of
them: `build, compile, integration, lint, ratchet, site, subprocess, typecheck, unit` — every job in
`ci.yml` and nothing else. `CodeQL` and both `Analyze (…)` checks are ABSENT, because code scanning here
is default setup and default setup does not fire on `merge_group`. So neither `dev-gate` nor `CodeQL` can
be required as this repository stands, and the verb refuses to make them so —
[required-contexts.md](required-contexts.md) carries the read, the refusal and its hatch.

**Adding the trigger is necessary and not sufficient.** It makes a check AVAILABLE to a queue entry; only
the base branch's "Require status checks to pass before merging" rule makes the queue WAIT for one. With
that rule off, the merge_group run either never starts or is ignored, and `enqueue` refuses on it —
[the ungated queue](ungated-queue.md).

## The shape of an invocation

```bash
github enqueue --pr <n> --repo <owner/name> --dry-run          # every fact and finding, no write
github enqueue --pr <n> --repo <owner/name>                    # …then press it
github enqueue --pr <n> --repo <owner/name> --dequeue          # take it back out
```

`--dry-run` reads the pull request, its base branch's queue and — since the pairing floor landed — this
machine's own pass records, prints the whole report, then stops before the door: no door record, no mutation.
The floor is about the PULL REQUEST, not about where you stand, so a detached HEAD and a dirty tree are both
irrelevant; `codex-loop-incomplete` means a missing plan or review, no checkout here holding the head commit, or
a finding standing after the second and last review pass that the body does not name under `## Codex review
leftovers` — naming every one there replaces the acknowledgement, and the body is read with the head commit.

Every report opens with the four lines that name its own subject — the pull request, the head commit, the
queue on the base branch, and the entry it currently holds. A verdict about the wrong subject is
indistinguishable from a true one unless its subject is on the page. **A NATIVE-STACK member takes a different route automatically**: [stack-merge.md](stack-merge.md).

## Four refusals no acknowledgement can clear

Three because the write is impossible, and the fourth because it would be unsafe:

- **the pull request is not open** — GitHub has nothing to queue; if it merged already, pull the base;
- **it is still a draft** — GitHub will not queue one. Undraft it with `github ready` first;
- **the landing branch has no merge queue** — there is no button to press. Land it with
  `slopweaver github merge --repo <owner/name> --base origin/main --head <branch> --description - --admin --number <n> < body.md`,
  or enable a merge queue on that branch;
- **that queue requires NO status-check contexts** — the write would work, and merge on arrival untested.

The fourth is the one a reader argues with, so it has its own page: why acknowledging it could not make the
queue wait, the measured landing it was written off, and why the required contexts are read from BOTH
governance mechanisms and unioned — [the ungated queue](ungated-queue.md).

An **already-queued** pull request is none of these: the verb reports its position and exits zero, so a
second harmless invocation never reads as a failure or as a duplicate press.

## The findings, and why they are acknowledgeable

The same shape `github merge` uses; acknowledging silences the REFUSAL, never the visibility of what was accepted.

| subject                    | fires when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-loop-incomplete`    | the Codex pairing floor ([the Codex skill](../../codex/SKILL.md)) is unmet, or no checkout on this machine holds the pull request's head commit, so nothing here can speak for it. ONE of the three subjects whose acknowledgement is recorded: naming it needs `--reason "…"` even without `--acknowledge-all`, and that reason reaches the door ledger — recorded only when the finding actually STOOD, so naming it on a clean floor writes nothing. **`github landing --press` names it ITSELF**, with one constant reason, on a pull request a human's standing approval covers ([landing-cadence.md](landing-cadence.md)) |
| `ci-not-green`             | a check on the head failed, is running or is queued, or the rollup disagrees with no cause named — unless every such check is PROVEN advisory: the base requires at least one context, the checks page was read whole, and no non-passing check is required or `dev-gate`. Then it raises nothing and the identity block prints `advisory red: …`, because the queue gates on required contexts alone (`src/review/gatingChecks.ts`)                                                                                                                                                                                            |
| `ci-rollup-superseded`     | every check on the head PASSED and a run a re-run already replaced still pins the rollup. A second recorded subject: it needs `--reason "…"` too, and that reason is meant to name the replacing run. **`github landing --press` names it ITSELF** on a replacement its own read PROVED ([landing-cadence.md](landing-cadence.md))                                                                                                                                                                                                                                                                                              |
| `required-context-missing` | a context the base REQUIRES has no run on the head at all — see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `review-not-approved`      | `reviewDecision` is neither `APPROVED` nor absent — or is absent with an open code-owner request GitHub's own `mergeStateStatus` does not clear. `CLEAN`, `UNSTABLE` or `HAS_HOOKS` over a COMPLETE request read means protection is already satisfied and the request raises nothing; a truncated read, a stated decision and `BLOCKED` all still refuse. The door re-asks GitHub itself, so a fleet `CLEAN` followed by a door `BLOCKED` refuses — [landing.md](landing.md) § A pending REQUEST is not a REQUIREMENT                                                                                                          |
| `not-mergeable`            | GitHub reports the pull request `CONFLICTING`, or has not finished computing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `private-terms-unchecked`  | the private-terms preflight could not read the prospective tree (the pinned head merged into the landing branch as just fetched): no terms file, a fork head, no checkout, a failed fetch, or a fetched branch that is not the landing branch. The third recorded subject, waived only BY NAME with `--reason`; `--acknowledge-all` never reaches it. A private-term HIT is a hold nothing acknowledges ([the landing sweep](../../../docs/security/private-terms.md#the-landing-sweep))                                                                                                                                        |

Accept them with `--acknowledge <subject,...>`, or all with `--acknowledge-all --reason "…"` — the reason is
required and printed verbatim, so an acceptance is never a bare flag.

**`ci-not-green` will often be acknowledged, and that is the design.** Queueing while the required checks still
run is the ordinary case a merge queue exists for — the queue re-runs them on the merged result anyway. The verb
runs no model, so it cannot judge that for you; printing the finding and making you accept it is what keeps the
decision visible instead of silent.

**`ci-rollup-superseded` is a SEPARATE subject so the routine acknowledgement cannot reach a live red.** The
rollup folds in every check suite on the head, superseded ones included, so a run that failed and was then
replaced pins it at `FAILURE` while every check you can still look at reads passed. This repository's own
landing sequence produces that on nearly every pull request — a push anchored after the fact fails `dev-gate`,
and repointing the anchor re-runs it green on the same head ([rebase-laps.md](rebase-laps.md)) — so it is the case a session
meets most often, and sharing a subject with a live red is what trained the reflex that clears both,
reading a pinned red as a flaky gate. The finding NAMES each pinning run (`dev-gate
<run-id> completed <time>`), so accepting it is a check against a run id, not a habit. A green head under a
failing rollup with NO superseded failure behind it stays `ci-not-green` — an unexplained disagreement keeps the
sharper subject. Both name the READ: `github checks --number <n> --log` ([job logs](job-logs.md)).

**What a READ can prove about it, and what it cannot.** `rollupSupersessionProof`
(`src/live/github/rollupSupersession.ts`) is the one place that answers the question a press has to settle for itself,
and it answers in three arms rather than a boolean: `absent` (the rollup and the latest-per-name view agree,
so there is nothing to explain), `proven`, and `unproven` carrying the sentence saying why. `proven` needs
EVERY superseded failure on the head to name a LATER run of its own name, ordered by GitHub's own two
timestamps — which is stricter than the comparison that picked the latest-per-name winner, deliberately: that
one resolves an undated side either way, and a run GitHub dated nothing could have started after the winner,
so `SupersededGithubCheck.replacedBy` is `undefined` unless both sides carry a timestamp. **A truncated check
page is never `proven`**, because a still-failing check may simply not have arrived in the page that was read.
`github landing --press` acts on `proven` only, and prints the `unproven` sentence beside the refusal.

**`required-context-missing` is the one finding the ROLLUP cannot raise, and the one not to wave through.**
`statusCheckRollup` summarises the runs PRESENT on the head, so a required context that never registered is
absent rather than red and the rollup reads `SUCCESS` over whatever else did run — that is a false GREEN, and
`ci-not-green` stays silent through it. MEASURED (`github enqueue --pr <n> --dry-run --json`):
`main` requires exactly `build` and `integration`, both jobs of the one `ci.yml`, and a pull request GitHub
calls `CONFLICTING` runs that workflow not at all while `CodeQL` and both `Analyze` runs still pass. The
remedy is a rebase or a re-trigger, never an acknowledgement: accepting it is accepting a gate that holds no
verdict. The same comparison refuses `github merge --admin` and non-zero-exits `github checks`. `--admin`
does NOT refuse a check that merely FAILED, and that is a boundary rather than an oversight: a red check is
visible in `github checks`, in the rollup and in GitHub's own UI, so judging it is the operator's lap; a
required context that never ran is visible in none of them.

**`review-not-approved` folds CODEOWNERS in — except where `reviewDecision` is NULL, and an ABSENT decision is not an
approval.** MEASURED on `acme/acme-admin`: null there while GitHub held an open
`asCodeOwner: true` request out to a team, and reading that NULL as approval printed `clean`. `undefined` falls back to GitHub's own
`asCodeOwner` requests under the SAME subject, and `requiresCodeOwnerReviews` is read rather than left unread. It errs
toward HOLDING BACK — a satisfied individual owner leaves no request behind; where a sole codeowner is the sole author
it can never be satisfied (`AGENTS.md` rule 1), so acknowledging is the path. Selector: [landing.md](landing.md).

## `--dequeue` is judged by nothing

Leaving a queue only ever narrows what happens next, so a guard on it would refuse the very action a caller
reaches for when something is wrong. `--dequeue` skips every finding above and does not even read the Codex
ledger; with no entry to remove it reports so and exits zero.

## The witness is a read-back, never the write's own word

Both GraphQL mutations return a `mergeQueueEntry` and discard it; success is reported only after a SEPARATE
read of it, and an enqueue that reads back with no entry is **UNCONFIRMED** and exits non-zero. That same read
is what answers a FAILED press, so a dropped connection is never left ambiguous — the three outcomes, the one
permitted re-send and the `UND_ERR_SOCKET` line a transport failure prints are in
[enqueue-witness.md](enqueue-witness.md). Waiting for the landing after it (never on git ancestry), and the
contract-widening change the queue evicts silently: [queue-waits.md](queue-waits.md).
