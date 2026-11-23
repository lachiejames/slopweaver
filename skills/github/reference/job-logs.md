# Reading what a failed CI job printed

Bundled reference for the `github` skill. The rule in one line: **a red leg is READ, never reproduced.**

Without these verbs nothing could open a CI job's log, so the shortest path from "the lint leg is
red" to "what did it say" was running the whole 65-gate `yarn lint` in the seat — which is exactly the
offload [AGENTS.md § Toolchain](../../../AGENTS.md) forbids. Measured: two seats ran the lane locally within an
hour of each other, and the second became a memory hold. The gap was a missing READ, not a missing
rule.

## The two verbs

```bash
slopweaver github checks --number <n> --log          # from a pull request — no run id to find
slopweaver github run-log 35502228255 --job lint     # from a run id, e.g. out of an Actions URL
```

`checks --log` is the one to reach for from a pull request: a failed check's `detailsUrl` already names its
Actions run AND its job, so nothing is searched for. It reads every FAILED check, groups them by run (one
head can carry two runs after a re-run) and prints one report per group. `run-log` is the same read reached
by run id, and it is the only way to see a job that PASSED (`--job <name>`).

Both take `--lines <0..2000>` (default 40), `--json`, `--repo` and `--home`. `--lines 0` asks for the
annotations alone.

**The raw read is refused, and the refusal names these two verbs.** `gh run view --log` / `--log-failed` and a
`gh api` fetch of an Actions run, its jobs, one job or any of their logs (`…/actions/runs/<id>[/attempts/<n>]
[/jobs|/logs]`, `…/actions/jobs/<id>[/logs]`) are blocked by the raw-command classifier
(`src/admit/rawGhReadRoute.ts`): each lands a data-sized log tail-first in the transcript. A plain `gh run
view <id>` and the other Actions endpoints (artifacts, workflows, a run list) still pass.

## Annotations come FIRST, and that ordering is the whole design

MEASURED on run 35502228255 job 106055916296 (`lint`, 1,138 lines): the two `##[error]` lines naming the
defect sit at lines 243-244, and the step does not close until 1103 — with 1085-1102 a wall of gate ticks
that PASSED. A report led by a tail prints eighteen green lines and none of the answer. So every
`##[error]`/`##[warning]` annotation is printed in full first, then the tail of the failing step.

Reproduce the shape:

```bash
slopweaver github run-log 35502228255 --repo lachiejames/slopweaver --job lint --json | jq '.jobs[].log'
```

## Three properties that are the contract, not details

- **The step boundary is the runner's own `##[error]Process completed with exit code N.` marker**, never the
  step's timestamps. GitHub reports `started_at`/`completed_at` at SECOND granularity and the post-job
  cleanup on the measured run ran inside the same second as the failing step's end, so a timestamp window
  swallowed 31 lines of `git config --unset` and reported them as the failure. A job whose log carries no
  such marker is reported as `residue`, unclosed, rather than having its whole tail read as one step's.
- **The log is STREAMED and only the window is kept.** A job log is data-sized — MEASURED 3,213,680 bytes
  for one `unit` job — which is the payload
  [typescript-patterns.md](../../../.claude/rules/typescript-patterns.md) § "Never let a data-sized payload
  through one JS string" forbids. There is no byte-range shortcut: MEASURED, the log blob host
  answers `Range: bytes=-65536` with `200` and the entire body and no `content-range`. So the read is a
  bounded ring buffer over a streamed body, and `--lines` is a real ceiling rather than a display option.
- **`--log` cannot be combined with `--wait` or `--until`.** It is a one-shot read over a settled head, and
  a report hundreds of lines long inside a polling loop would put in a transcript exactly what
  [rule 7](../../../AGENTS.md) keeps out of one.

## Where this is REMEDY text, not a suggestion

`github enqueue`'s `ci` and `ci-rollup-superseded` findings both name the read
(`src/cli/commands/github/enqueueFindings.ts`), so a seat meeting a red rollup is told to open the log
rather than left to work out how. `ci-rollup-superseded` is the sharper case: every check on the head
passed and a superseded run still pins the rollup, so the question is always "what did the run that is
pinning it print" — see [merge-queue.md](merge-queue.md) § the findings table.

## A transient red leg is re-run without asking

When the log shows a transient provider error — a GCP `iamcredentials` 503, `upstream connect error … overflow`,
a Pulumi preview that never ran — the fleet re-runs the leg with no card and records the act with `slopweaver
autonomy record` (rule 10). A 503 is a transient error with nothing on our end, and a human would simply re-run it. A leg red on a real test failure or a lint break is a fix,
never a re-run.

The re-run is a verb, through the door, never raw `gh run rerun`:

```bash
slopweaver github rerun --repo acme/acme-admin --run-id 36945592960 --dry-run   # what would be re-run
slopweaver github rerun --repo acme/acme-admin --number <n>                       # every failed run on the head
```

It re-runs a run's FAILED jobs (a `failure`, `cancelled` or `timed_out` conclusion) and confirms the write by
reading the run back at its next attempt, because GitHub's 201 carries no body. A run still in progress is
reported `still running`, never sent: GitHub refuses that re-run. A finished run with no failed jobs that is
not clean either — `startup_failure`, `action_required` — is `cannot re-run` and exits 1. With `--number`, a
failed run a newer run of the same workflow and event replaced is `superseded` and left alone, and a head
whose runs overflow one page is refused rather than called "nothing failed". A send that errors is read back,
so a write GitHub accepted before the answer was lost still reports `re-ran`. A raw `gh run rerun --failed` is
refused and the refusal names this verb; a whole-run or `--job` re-run gets the generic raw-GitHub refusal.

## When the base moved: cycle, never re-run

A `pull_request` run checks out `refs/pull/N/merge`, the test merge of the head onto the base, and a re-run
reuses the one its run first had. So once the base has moved, `rerun` re-runs the OLD merge, and so does a bare
close-and-reopen until GitHub has recomputed the ref. Measured on one acme/acme-admin pull request: a re-run and a first reopen both ran on
the old base after staging had moved, and only a reopen after GitHub recomputed ran on the new base.

```bash
slopweaver github cycle --repo acme/acme-admin --number <n> --dry-run   # is the merge ref fresh yet?
slopweaver github cycle --repo acme/acme-admin --number <n>             # close + reopen, through the door
```

`cycle` reads the pull request, `refs/pull/N/merge`, that commit's parents and then the base's live tip, and
calls the ref fresh only when its parents are exactly `[base tip, head]` and it is the commit the pull request
names. Not fresh comes in two kinds, and only one is worth waiting on:

- **Computing** — `mergeable` null, the ref missing or behind `merge_commit_sha`, or a merge of an old head
  (a push starts a recompute at once): exit 4, nothing written, run it again.
- **Settled** — a finished merge onto a base that has since moved: exit 1. A read does not recompute it: on
  acme-admin, after staging moved, four open pull requests still merged onto its previous tip 45 minutes later,
  across repeated reads. On another the recompute followed a reopen, so `--prime`
  cycles anyway to trigger it; that run's CI is on the old merge, and the next plain `cycle` is the real one.

It refuses, exit 1, a merged or closed pull request (it does not cycle one somebody closed), a deleted head
fork, auto-merge on (a close switches it off), a merge-queued one (a close drops it), a native-stack member,
and a conflict, and it reads the pull request again just before the close and refuses on the same list, or
defers with exit 4 when the head, merge commit or `mergeable` moved since the judgement. It closes and reopens
as one door-recorded write. A reopen counts only when GitHub's own answer
to it says open, never a separate read, which can lag a close. It is sent a second time if the first is not
confirmed, and `may be CLOSED NOW` is printed loudly if neither is. A close whose answer was lost is followed
by a reopen regardless. Right after a `--prime`, a plain run can still read settled before GitHub starts the
recompute: run it again later, never prime twice. Not checked: the base moving after the judgement, which no
pull-request read shows, or somebody closing or enqueueing it in the round trip between that last read and the
close or reopen. `gh pr reopen` names this verb.
