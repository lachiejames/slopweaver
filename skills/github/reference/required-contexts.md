# The required contexts a base branch enforces, and the scope bug that made every row unlandable

`ci-green` is the one of `github landing`'s six tests that reads something the pull request itself does not
carry. Everything here is that read: why the rollup is not enough, which half of the answer is per BASE and
which is per HEAD, and the measurement that separating them closed. The six tests themselves are
[landing.md](landing.md); the module is `src/live/github/requiredContexts.ts`.

## Why `ci-green` folds in the required set at all

**The rollup cannot see a context that never ran.** `statusCheckRollup` summarises the runs PRESENT on a head,
so a required context that never registered is not `FAILURE` in it — it is absent, and the rollup reads
`SUCCESS` over whatever else ran. A pull request whose `build` never started therefore reports green on
GitHub's own aggregate while being unmergeable.

A gate that could not be READ at all is `unknown`, never "requires nothing". The two arms are distinct on
purpose: `missing` is a MEASURED absence, and `unproven` is a name absent from a page the read truncated, so
nothing claims a context never ran on evidence that could not have shown it running. A truncated head is
re-read whole first ([landing.md](landing.md)), so `unproven` survives only a list cut short at 500, a head
that moved mid-read, or a context node that did not decode (`contextsView` counts it as unread, never drops it).

## The required SET is per base; the JUDGEMENT is per head

One live protection-plus-rulesets union is read per base branch and shared, which is right and cheap — a base
requires what it requires, whoever is targeting it. Whether a required name is absent from a head, and what
GitHub says about that head's merge ref, are facts about ONE pull request.

**Conflating the two made the whole fleet read unlandable.** MEASURED on `lachiejames/slopweaver`:
both halves were computed together inside the per-base loop, from whichever pull request was seen first on
that base, and the resulting gate was handed to every other row on it. So `missing: ["build"]` landed on
**18 of 23** open pull requests — each `11/11 passed` with `build` present and green — and the gate
reported `MERGEABLE` on three rows while each row's own `conflict` cell read `CONFLICTING`. `ci-green` takes a non-empty `missing` as `fail` before it reads anything else, so
`tally.ready` was **0** and `byDispatch` named four acts across 23 rows.

The fix is a type rather than care: `RequiredSetRead` is the per-base half on its own, and `gateForHead`
refuses to compose a gate without a head's own checks. Re-check the property with

```bash
slopweaver github review-state --repo <slug> --include-drafts --no-slack-live --json
```

and compare each row's `requiredContexts.mergeable` against its own `conflict.mergeable`. They must agree on
every row.

## The mergeability the gate carries is the SETTLED one

`requiredContexts`'s value is naming `CONFLICTING` as the cause of a required context that never ran, and the
unsettled field GitHub answers on a first read is `UNKNOWN` on most of a cold fleet — 14 of 21 rows on the
same read. The gate takes the field the mergeability re-read writes, so it agrees with the row's own
`conflict` cell rather than describing an earlier read.

## Changing the set — `github required-contexts`, and the one measurement it takes first

A CI check is normally a required check, or else it is meaningless.
Everything above READS the set; this verb governs it, so the setting stops being reachable only through
GitHub's own settings page, which rule 3 puts outside the door.

```bash
github required-contexts --repo <slug> --branch main                      # read; writes nothing
github required-contexts --repo <slug> --require CodeQL --dry-run         # judge the change, no write
github required-contexts --repo <slug> --require site --drop compile      # ADD and REMOVE, unioned
github required-contexts --repo <slug> --require a,b --exact              # replace the WHOLE list
```

**`--require` ADDS.** GitHub's endpoint replaces the array, so a caller sending only the new name would drop
everything already required — and a queue requiring NOTHING merges each entry untested, which is
[the ungated queue](ungated-queue.md). The verb composes the list from what it just read, `--exact` is the
explicit opt-in to a replacement, and a change leaving the set empty is refused with no hatch at all.

**Before an addition it MEASURES whether that context runs on a merge group**, because a required check that
never arrives does not fail an entry — the queue stalls on it ([merge-queue.md](merge-queue.md)). Three reads,
and no one of them decides it: recent `merge_group` workflow runs give the suites Actions owns, each entry
head's check SUITES give every suite cut on a `gh-readonly-queue/` ref, and the entry head's check RUNS give
the names. A name counts as observed only when its suite is in the union of the first two.

Both halves of that union are load-bearing, in opposite directions. The suite filter is what keeps a
push-only context out: a successful landing fast-forwards the base to the entry's own head commit, so the
`push`-event run attaches its checks to the same sha, and unfiltered it reads as present on a queue entry.
The queue-REF half is what lets a context in that Actions never ran — a GitHub App posts its check into a
suite no workflow run owns, and on the Actions set alone every such context reads as never observed, which is
the refusal firing on a name that really does gate the queue. `--json` reports `mergeGroup.queueRefSuites` for
exactly one reason: it is the witness that this half resolves at all, since `head_branch` is nullable on
GitHub's schema and a union that silently matched nothing would leave the names identical. MEASURED over
eight entries on `main`: 54.

An addition no entry carries is refused, with `SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT=1` as the hatch.
**Three blind spots, each a legitimate reason to take it, and the hatch row spells all three**: a genuinely
NEW job that has not had an entry yet — legitimate exactly when you have read a `merge_group:` trigger in the
workflow file rather than assumed one; a legacy COMMIT STATUS rather than a check run, which this window
CANNOT see and structurally cannot be made to, since a status carries no suite and the entry head and the
commit it lands as are the same sha; and a window holding more than 100 runs, suites or check runs, because
each read takes one page.

**MEASURED on `lachiejames/slopweaver` `main`**, over eight queue entries:

```text
required:  build, integration
on a merge group: build, compile, integration, lint, ratchet, site, subprocess, typecheck, unit
```

So `CodeQL`, `Analyze (actions)`, `Analyze (javascript-typescript)` and `dev-gate` run on NO queue entry, and
none of them can be required as this repository stands. `dev-gate` is by construction — its subject is the
pull-request body and a `merge_group` event carries no pull request. Code scanning is DEFAULT SETUP here,
which fires on `pull_request`, `push` and a schedule and not on `merge_group`; making `CodeQL` requirable
means converting it to advanced setup with a workflow file that carries the trigger, which is a change to the
repository's scanning configuration rather than a protection setting. Reproduce:

```bash
slopweaver github required-contexts --repo lachiejames/slopweaver --branch main --entries 8 --json
```
