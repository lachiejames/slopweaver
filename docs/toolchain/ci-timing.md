# CI job timing is reported, not red

Every lap ends with `ci.yml`'s `ci-timing` job, which runs `slopweaver github ci-timing --run-id <n>` over the
run it is itself part of and prints each job's wall time, slowest first. It exits 0 whatever those times are. It
exits non-zero only when the run cannot be read whole, including a job row with no readable name, because a report
that silently leaves a job out reads like a faster run.

```bash
slopweaver github ci-timing --run-id <n>
```

**There is no bar, no baseline and no verdict.** The owner ruled CI job timing reported, not red. The
five-minute bar every CI check aims at is decided after a measured window on
the runner the repository settles on. Until then, a number committed as a ceiling would only record whichever
runner happened to be measured. The earlier gate reddened laps on runner noise against two baseline files under
`.baselines/`; nothing reads those files now.

**What it reads.** It reads `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` across every attempt of the
run, so a re-run of failed jobs is timed on the attempt that ran each job. A skipped job, or one with no start or
completion instant, prints as `not measured` rather than as a zero. The job omits its own row, because it is still
running while it reads.

**It is not a required context**, and it runs on every event. On `push`, `integration` is skipped and prints as
not measured.

**A window of runs** is `github ci-runs`, in [ci-timings](../../skills/github/reference/ci-timings.md).
