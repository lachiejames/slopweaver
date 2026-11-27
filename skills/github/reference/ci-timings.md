# Measuring CI — `github ci-runs`

`github checks` answers "is this pull request green". This answers "how long did every check take", which
needs a WINDOW of runs rather than one, and per JOB rather than per pull request. It exists because every CI check
aims to finish under five minutes.

## The read

```bash
slopweaver github ci-runs --branch main --event push --runs 20
slopweaver github ci-runs --branch any --event pull_request --runs 20 --steps
slopweaver github ci-runs --branch main --event push --runs 20 --json > before.json
```

It reads `GET /actions/workflows/{file}/runs` once and `GET /actions/runs/{id}/jobs` per run, both through
the shared `githubReadRest` seam — the same door every other GitHub read uses. No second client, no raw `gh`.

## Three figures, kept apart on purpose

| figure    | what it is                    | what it means                                                    |
| --------- | ----------------------------- | ---------------------------------------------------------------- |
| **wall**  | `started_at` → `completed_at` | the job's own work. **This is what the five-minute bar judges.** |
| **queue** | `created_at` → `started_at`   | waiting for a runner — unless the job has `needs`                |
| total     | `created_at` → `completed_at` | what a watcher experiences                                       |

A job declared with `needs` reports its whole wait for those dependencies as QUEUE time, and GitHub's payload
carries no dependency edge to tell that apart from contention. `DEPENDENCY_BLOCKED_JOBS` in
`src/live/github/runHistoryParse.ts` names them, and those rows print `(needs)` instead of a number.

## Three traps, each of which produced a wrong number first

**A skipped job is not a fast job.** `integration` is declared
`if: github.event_name == 'pull_request' || github.event_name == 'merge_group'`, so every `push` run of `main`
skips it — and GitHub still emits a job record carrying `started_at` and `completed_at` a fraction of a second
apart, sometimes in the wrong order. Timed naively, it prints (measured):

```text
ok    integration      20   -1:-1    0:00    0:00     0:00
```

The slowest check in the workflow, presented as the fastest, with a twenty-run sample behind it. A `skipped`
conclusion yields no duration at all, is counted in `skipped`, sampled nowhere, and renders `n/m` with a
line saying the event does not trigger it. This is the same skipped-counts-as-green trap
`.github/workflows/ci.yml`'s own `build` comment documents, arriving through the measurement instead.

**A negative span is not a measurement.** `spanSeconds` answers `undefined` rather than a number below zero,
because a negative duration sorts to the top of a fastest-first list and sits under every ceiling ever written.

**`--branch` filters the run's HEAD ref.** A pull request's head is its feature branch, never its base, so
`--event pull_request --branch main` matches nothing — every time, on any repository. `--branch any` omits the
filter (it does not send a wildcard; GitHub has none, and a literal `any` would filter for a branch of that
name and answer an honest, misleading zero).

**A window is ONE workflow file, so the slowest check on a pull request can be invisible to it.** `--workflow`
defaults to `ci.yml` and reaches `pr-body-gate.yml` by name — but CodeQL here is GitHub **default setup**,
defined in no file in this repository, so no `--workflow` value reaches it and neither does `ci-timing`, which
reads one run id while CodeQL runs as its own. Read it off the pull request instead: `github checks --number
<n> --json` gives its run id, and `github ci-timing --run-id <that>` times its jobs. Any five-minute
claim taken from `ci-runs` alone is a claim about the part that is not the tail.

## What a percentile here does and does not prove

p50/p95/max are **nearest-rank** over the window, no interpolation — `percentileSeconds`, spelled once so the
page and a pull-request body compute it identically. A p95 over twenty runs is twenty
samples of one machine class on one set of commits: it says what this workflow costs now, and nothing about
what it costs on a different runner, a cold cache, or a tree twice this size. Quote a p95 of a WINDOW, never a
lucky single run.

## The measurement this bought

Twenty `pull_request` runs with `--steps`:

| job         | p95 wall | install | its own command        |
| ----------- | -------- | ------- | ---------------------- |
| lint        | 7:23     | 0:41    | Lint 6:33              |
| subprocess  | 6:18     | 0:42    | Subprocess tests 5:26  |
| unit        | 5:49     | 0:41    | Unit tests 4:58        |
| integration | 4:48     | 0:42    | Integration tests 3:53 |
| typecheck   | 1:50     | 0:41    | Typecheck 0:57         |
| build       | 0:04     | —       | verdict only           |

Queue time was 0:02 on every unblocked job, so none of this is runner contention. Two causes were named off
that table rather than guessed at: `yarn install --immutable` is a flat ~40s tax paid five times per run with
no dependency cache anywhere in the workflow, and `dev lint` ran its 65 gates strictly one at a time, so its
wall time was the sum of 65 process startups plus 65 bodies on a multi-core runner.

## What each cause turned out to be worth

**The install cache was a near-no-op, and the measurement is why it did not land.** Two `pull_request` runs
of the same tree, one cache miss and one hit: `setup-node` 0:05 → 0:12, `yarn install --immutable`
0:39 → 0:32, the save step 0:03 → 0:00. About **3s net per job** against a 7:22 `lint` job. The cause is
`nmMode: hardlinks-global` — the install's cost is dominated by the LINK phase, which the Berry zip cache
(`cacheFolder`) does not touch. The change was closed with that measurement rather than merged.

**It was tried a SECOND time, by a session that had not read this row, and measured the same.** Two
`pull_request` laps of one tree — a cold lap to populate and a warm lap to judge, stated in
the body before either ran so the populate could not be read as the answer. `setup-node` 0:05 → 0:14 and
`yarn install --immutable` 0:40 → 0:31: the restore costs what the install saves, to within a second, on four
jobs independently. Job wall time moved inside run-to-run noise — `unit` 5:49 → 5:48, `subprocess` 5:08 →
5:06. Closed, like the first. **Read this section before proposing a dependency cache here**; that is what it is
for, and two pull requests paid for the same sentence.

**The cache that stands is a different shape, and it is held to a different job.** Both closed attempts cached
the archives ALONE; the entry `ci.yml` restores now (pinned by `ci-offload-contract`,
`src/devLint/ciDependencyCache.ts`) holds the installed `node_modules`, which removes the link phase, AND the
archives (`~/.yarn/berry/cache`). The archives are there for the network, not the clock: an entry without them
made every job on a hit print `YN0013: 953 packages were added to the project (+ 2.02 GiB)`, a registry download
one `write ECONNRESET` failed (desktop-e2e, job 140394290086). Re-read a job's Fetch step with
`slopweaver github run-log <run-id> --job lint --from "Fetch step"`; on a hit it prints no `YN0013`. Hardened mode
on a public pull request still queries registry metadata, and downloads no archive.

**Gate concurrency was worth the whole gap.** `dev lint` runs four gates at once, each on a worker
thread blocked on its own `spawnSync`, with the memory-hungry gate alone. Measured on `pull_request`:

| job  | before | after | its own command  |
| ---- | ------ | ----- | ---------------- |
| lint | 7:23   | 4:15  | Lint 6:33 → 3:23 |

Every lap prints the ratio of summed gate time to its own wall time, which the serial loop made equal by
construction, so the CI log carries its own falsifiable witness that concurrency engaged. `prettier` is
the floor of that step at roughly three quarters of it, which makes it the next cut inside `lint`.

**The subprocess lane was obeying a developer-machine worker cap on a runner it has to itself.**
`config/vitest/subprocess.ts` capped `maxWorkers` at 4, a number measured against a 15-core laptop running a
whole fleet. On CI the key is omitted entirely, so Vitest takes the runner's own `availableParallelism`.
Measured on `pull_request`:

| job        | before | after | its own command              |
| ---------- | ------ | ----- | ---------------------------- |
| subprocess | 6:16   | 4:52  | Subprocess tests 5:22 → 4:01 |

`retry: 1` and the two 60s budgets are untouched — they are the lane's existing guard against exactly the
timing reds a bigger worker count could cause, and removing a cap is not a reason to remove a net.

## The state of the bar

After the two cuts above, on `pull_request`:

Every "after" below is a snapshot of one read, taken after those two cuts and before the unit shard split and
the later cuts moved every lane. **Which runs it was taken over is not recorded anywhere checkable**: `unit`
read 337–372 one day and 337–349 on a re-read the same day. Re-take it with
`slopweaver github ci-runs --branch any --event pull_request --runs 30 --json`; this tree has recorded a spread
of 51s on `unit`, 62s on `lint` and 98s on `integration`, so one run is never the number.

| job         | before | after | over the bar |
| ----------- | ------ | ----- | ------------ |
| lint        | 7:23   | 4:26  | no           |
| subprocess  | 6:16   | 5:01  | marginally   |
| unit        | 5:49   | 6:29  | YES          |
| integration | 4:48   | 4:44  | no           |
| typecheck   | 1:50   | 1:49  | no           |
| build       | 0:04   | 0:03  | no           |

`unit` is the one job the cuts have not touched, and it is its own test step rather than its install: over the
same eight runs the `Unit tests` step is p50 4:50 against the job's own p50 5:45. Both figures come from one
`--steps` read, so they are comparable; the 6:29 in the table above is a different statistic from either and
not interchangeable with them. That step is the next cut
inside `ci.yml`.

**But `ci.yml` is not the tail.** The table above already marks `unit` and `subprocess` over the bar, so
stopping there would not have claimed the bar was met — it would have named the wrong job as the thing to
cut next, because the slowest check on the pull request is not in that table at all. Measured on one pull
request's head, through the two-step read the trap above describes:

| check                             | wall | over the bar |
| --------------------------------- | ---- | ------------ |
| `Analyze (javascript-typescript)` | 7:26 | **YES**      |
| `Analyze (actions)`               | 1:02 | no           |

CodeQL's TypeScript analysis is the slowest check on the pull request — slower than `unit` by 88 seconds —
and the one check nothing here can cut, because default setup owns the workflow. What is available is default
setup's own configuration, not a change to `ci.yml`, a separate act from every cut on this page.

**Nothing holds the bar yet, by ruling.** `ci.yml`'s `ci-timing` job prints every job's wall time on every
lap and never reddens on a timing; the bar is decided after a measured window on the runner the repository
settles on. [toolchain/ci-timing.md](../../../docs/toolchain/ci-timing.md) has the ruling and what the report
reads. It reads one run id, so both CodeQL analyses are outside it.

## Why a job went red is a DIFFERENT read

This page's verbs time a job. Neither says why a red one is red — that is `github checks --number <n> --log`
from a pull request, or `github run-log <run-id> --job <name>` from a run id, both in
[job-logs](job-logs.md). Reach for them before inferring a gate failure from the gate's own source.

MEASURED, which is what that reference's rule is for: `lint` was red for five
consecutive laps and every cause was inferred by reading gate source, because the seat had not yet pulled
the verb. Each inference was falsified by the next lap, and the leading one accused a
gate (`named-object-params`) that the log showed GREEN. The log named all five real causes at once.
