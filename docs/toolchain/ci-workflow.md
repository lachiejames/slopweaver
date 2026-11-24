# The laps run in parallel, and `build` is only their verdict

Part of [Toolchain](../toolchain.md).

CI work that does not depend on other CI work runs as separate jobs: one for lint, one for unit tests, one for
subprocess tests, because none of them depend on each other and the suites only grow.

MEASURED through the door on three pull requests, before the split: `build` 11m56s / 11m53s / 11m46s, as ONE job
running install 42s → lint 4m34s → typecheck 46s → unit 3m18s → subprocess 2m21s → coverage floor in series.
So `lint`, `typecheck`, the unit shards, `subprocess`, `compile`, `desktop` and `site` are jobs that start together,
each with its own checkout and install, and the lap's wall time is the slowest of them rather than their sum.

**`build` is the job that turns their results into one verdict**, and that is not tidiness:
`build` is one of `main`'s required contexts, so renaming the check would need a ruleset change and strand
every open pull request waiting on a context that never arrives. A new leg joins `build.needs` instead of the
ruleset — which is what makes the shape scale as the suites grow. `ci-offload-contract` holds the property that makes the aggregator safe rather than a
rubber stamp: see [its entry above](lint-reference-tests-and-ci.md).

Three things this does NOT buy, stated because each is easy to assume:

- **It removes no CI work.** Parallel installs are still separate installs — the aggregate runner minutes
  go UP while the wall time goes down.
- **It assumes concurrent runners.** Every leg starts beside `integration`, `dev-gate` and both CodeQL
  analyses. Read the real start delays off a landed run rather than assuming.
- **CodeQL is unaffected, and is the critical path.** `Analyze (javascript-typescript)` is not a required
  check, so nothing waits on it to MERGE — but a session watching `github checks --wait` waits for it, and
  every second cut out of `lint`, `unit` or `subprocess` below its line buys that session nothing. MEASURED
  on one pull request's head: **7:26**, against `unit`'s 6:29, so it is the slowest check on
  the pull request. It is GitHub default
  setup, defined in no file here, so it is not reachable by a change to `ci.yml`. CodeQL default setup is
  defined outside this repository and may be organisation-controlled: GitHub answers HTTP 422 when policy
  prevents an administrator from disabling it
  ([code-scanning](../../skills/github/reference/code-scanning.md)).

## The unit lane is six shard jobs and a merge

MEASURED on the larger runner (16 vCPU), paired jobs on one tree: the whole lane in one
job spent 6:54 in its test step, and its own summary put `import` at 1,308 of about 2,400 worker-seconds —
110,680 module evaluations with no single hub over 2.4s, on a runner already saturated. So neither a lazy
import nor more concurrency moves it, and the cut that scales with the tree is more runners. `unit-1`…`unit-6`
each run `yarn test:unit --shard=i/6 --reporter=default --reporter=blob` and upload the report; `unit` needs
all six, downloads them, runs `yarn test:unit:merge` (0:38) and then the coverage floor over the merged report.

- **The lane runs non-isolated** (`isolate: false` in `config/vitest/unit.ts`): a worker is reused across
  files, so a file no longer pays a fresh fork, a fresh `node_modules` load and a fresh module graph. The setup
  files still run per file and put back, at the worker's baseline, every variable and browser-sniff global they
  own (`src/__tests__/envSnapshot.ts`). MEASURED on one branch: the six shards' p50 walls summed 1,233s over its five
  laps against 1,572s over main's last ten push laps on the same tree, with `lint`, `compile` and
  `subprocess` within 2s of main as the control (`slopweaver github ci-runs --branch <branch> --runs 10`).

- **The count is one constant**, `UNIT_SHARD_COUNT` in `src/testLanes/unitShards.ts`. Every job name, command
  and report file derives from it, and `ci-offload-contract` / `ci-trigger-contract` refuse a `ci.yml` that
  disagrees. Raise it when the slowest shard nears the bar.
- **The merge refuses an inexact report set** before it merges, because `vitest --merge-reports` checks only
  the Vitest version: a shard whose artifact never arrived would otherwise merge into a smaller lane the floor
  then passes. After merging it refuses again unless every test file the lane selects was merged EXACTLY
  once: MEASURED, one shard's report copied under all six names merged with exit 0.
- **Artifacts are the one widening of the worker action rule**, by job: upload in a shard, download in
  `unit` (`src/devLint/ciWorkerActions.ts`). Neither can turn a failed command into a passing job.

```bash
slopweaver github ci-runs --branch ci-perf-experiments --event pull_request --workflow perf-experiment.yml --steps
```

## Every job that installs the root project restores it from a cache first

Only `typecheck` writes the `node_modules` cache, on a `push` to `main` that missed; every job but `build`, `site`
and `desktop` restores it before `yarn install --immutable`. Measurements, the key and every pinned shape:
[ci-install-cache.md](../ci-install-cache.md).

## A CI job runs only on an event that could change its outcome

This is a STANDING rule rather than a fix to three jobs. CI triggers align with when it makes sense to rerun
CI: where a pull request trigger reruns a job whose outcome the trigger could not possibly change, such as
running unit tests when only the PR description changed, the trigger is made more specific. The rule applies
to every CI job, more so as more moves into CI.

MEASURED, which is what the rule answers — 49 `ci.yml` laps across 20 merged pull requests, read through the
door:

|                                      | measured                                   |
| ------------------------------------ | ------------------------------------------ |
| one `ci.yml` lap                     | p50 9m23s, p95 9m45s, band 8m47s–9m59s     |
| laps per landing, on ONE head commit | 2.45                                       |
| laps that re-ran byte-identical code | 29 of 49                                   |
| wall spent on those re-runs          | 270m58s of 457m52s, **13m32s per landing** |

One serial job was the whole critical path then (job p50 9m22s against a lap p50 of 9m23s), which is why
the laps run in parallel (top of this page). One pull request ran three full laps on
one commit: 9m47s, 9m59s, 9m32s. Reproduce any of it:

```bash
slopweaver github read https://github.com/lachiejames/slopweaver/pull/<n> --json \
  | jq '.data.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[]
        | {name, startedAt, completedAt, detailsUrl}'
```

Group by the run id in `detailsUrl`; one group is one lap. **`slopweaver github checks` cannot answer this**:
its rollup query asks GitHub for `completedAt` without `startedAt`, and it dedupes to the latest run per
name, so on that pull request it reported 6 checks where the head commit carried 12 across 3 laps. `github read` requests
both.

## The shape the rule takes here

**Two workflow files, because a trigger list is workflow-scoped and an outcome is job-scoped.**

| file                                 | `pull_request.types`                              | jobs                                                    | why those actions                                                                                                                  |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`           | `opened`, `synchronize`, `reopened`               | every lap above, `build`, `integration` and `ci-timing` | every one reads only the checked-out MERGE tree (and `build` only its workers' results), and these are the actions that change it  |
| `.github/workflows/pr-body-gate.yml` | those three plus `edited`, `labeled`, `unlabeled` | `dev-gate`                                              | its subject IS the pull-request body, title and labels, so a body-only fix or an added kind label must be able to clear a red gate |

**`dev-gate` reads the labels LIVE, never from the event.** `github stack push` creates a pull request and only
then adds its kind label, because GitHub's create call takes no labels, so the `opened` payload never carries it.
The Dev gate step runs after the install and reads the pull request's current labels with the job's own read-only
token (`src/devGate/prLabels.ts`); a failed read is its own named red, never a fall back to the event's list. That
narrows the race rather than closing it: a push slower than the job's setup still reads no label, and the
`labeled` run is then what clears it.

**Neither lists `ready_for_review`.** No job reads the draft flag, so readying a pull request creates no
workflow run at all and a draft's green stands through it rather than re-earning a lap on the identical
commit.

**Do not "fix" this by putting the jobs in one file behind an `if:`.** A job skipped by `if` still emits a
check run, whose `skipped` conclusion
counts as PASSING both to GitHub's branch protection and to `PASSING_CONCLUSIONS` in
`src/live/github/checks.ts`, and it is the LATEST run for that name — so a description edit would turn
a **red `build` green** in the rollup. Two files never fire on an event their jobs do not need, so no check
run is created to be misread.

**A base retarget is the one case the narrowing gives up.** GitHub reports a retarget as `edited` (carrying
`changes.base`) and fires nothing else for one, so `build` and `integration` do not re-run on the pull request
when its base moves. On a base with a merge queue the `merge_group` run catches it, testing each entry against
the real base tip with `build` and `integration`. `main` has no queue, so there `build` and `integration` re-run
only on the next push or a reopen. Confirm the required set rather than trusting this sentence — `slopweaver github checks --number <n> --json`,
field `gate.required`, which reads `["build", "dev-gate", "integration"]`.

**Gated by `ci-trigger-contract`** ([above](lint-reference-tests-and-ci.md)), so this survives the next job somebody adds: an undeclared job,
a `types` entry no job needs, and a job name in two files each fail the gate by name.
