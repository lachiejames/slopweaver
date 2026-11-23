/**
 * The `github` verbs that read what CI DID, split out of `./github.ts` when that manifest passed its size
 * ratchet — the same seam and the same reason as `./githubStackUsage.ts`.
 *
 * They belong together rather than merely fitting together. `checks` reports one pull request's STATE and
 * never a duration; `ci-runs` times a window of runs; `ci-timing` times every job of ONE run, the one it runs
 * in; `run-log` prints what a red leg actually said. None of the timing verbs has an opinion — CI timing is
 * reported, not red. That ladder — state, measurement, evidence — is one story, and the rule that a seat
 * reads CI rather than re-running a lane locally is why every rung of it exists.
 *
 * `checks` reports one pull request's CI checks as a compact status line via GitHub's own aggregate
 * `statusCheckRollup` GraphQL field — the same live seam `read` uses — instead of a session hand-rolling a
 * raw `gh pr checks` polling loop. It is a pure read: `effect: "external-read"` + `doorRouted: false`,
 * exactly like `read`/`search`.
 *
 * `ci-runs` is the other half of the same question, and the reason it is a separate verb: `checks` reports a
 * pull request's check STATE and carries no duration at all, so asking whether every check is under five
 * minutes had no door to be asked through and could only be answered with the raw `gh` rule 3 bans. It
 * reads a WINDOW of workflow runs through the shared REST seam and times each JOB, keeping wall
 * (started→completed) and queue (created→started) apart — a job with `needs` reports the whole wait for its
 * dependencies as queue time, so those print `(needs)` rather than a number a reader takes for runner
 * contention. A pure read: `effect: "external-read"` + `doorRouted: false`, like `checks`/`review-state`.
 *
 * `ci-timing` is the workflow job's own report: every job of the run it is part of, slowest first, and exit 0
 * whenever a report was produced. It enforces no bar; the five-minute bar is decided after a measured window
 * on the runner the repository settles on (`docs/toolchain/ci-timing.md`).
 *
 * `run-log` closes the loop: a red leg is READ, in this seat, from what CI itself printed, rather than
 * reproduced by running the lane again locally.
 *
 * `rerun` is what follows a red leg `run-log` showed was transient — an outage, a flaky runner — and the one
 * WRITE here: it re-runs a run's failed jobs through the door (`doorRouted: true`) and confirms by reading
 * the run back at its next attempt. Before it existed a seat reached for raw `gh run rerun --failed` under
 * `SLOPWEAVER_ALLOW_RAW`, the commonest autonomous CI act with no door at all.
 *
 * `cycle` is the second write, for the case `rerun` cannot answer: a re-run reuses the merge commit its run
 * first checked out, so once the base has moved it re-runs the OLD merge. It
 * closes and reopens the pull request through the door, and only once `refs/pull/N/merge` is the merge of the
 * current head onto the base's live tip — exit 4 while GitHub is still computing it, and a refusal naming
 * `--prime` when GitHub has settled it onto an old base, which no amount of reading changes.
 */

import { githubChecksUsage, githubCiRunsUsage, githubCiTimingUsage } from "../commands/github/ciUsage.js";
import { GITHUB_CYCLE_USAGE } from "../commands/github/cycleUsage.js";
import { GITHUB_RERUN_USAGE } from "../commands/github/rerunUsage.js";
import { GITHUB_RUN_LOG_USAGE } from "../commands/github/runLogUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The four CI-reading verbs and the two CI writes, spread into `githubManifest` in `./github.ts`. */
export const githubCiManifest: Readonly<Record<string, VerbManifestEntry>> = {
  checks: lazy({
    load: () => import("../commands/github/checksRun.js").then((m) => m.githubChecksCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github checks --number 123 --wait",
      parseRejectIsIoFree: true,
      summary: "Report one pull request's CI checks as a compact status line, optionally polling until done",
      usage: githubChecksUsage(),
    },
  }),
  "ci-timing": lazy({
    load: () => import("../commands/github/ciTimingRun.js").then((m) => m.githubCiTimingCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github ci-timing --run-id 12345678",
      parseRejectIsIoFree: true,
      summary:
        "Print every job of one workflow run with its wall time, slowest first — reported, never red, " +
        "whatever a job took",
      usage: githubCiTimingUsage(),
    },
  }),
  "ci-runs": lazy({
    load: () => import("../commands/github/ciRunsRun.js").then((m) => m.githubCiRunsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github ci-runs --branch main --event push --runs 20",
      parseRejectIsIoFree: true,
      summary:
        "Time every CI job over a window of workflow runs — wall and queue apart, ranked slowest-first, " +
        "the measurement `checks` cannot make because it reports state and never duration",
      usage: githubCiRunsUsage(),
    },
  }),
  "run-log": lazy({
    load: () => import("../commands/github/runLogRun.js").then((m) => m.githubRunLogCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github run-log 35502228255 --job lint",
      parseRejectIsIoFree: true,
      summary:
        "Print what a failed CI job actually printed — every annotation in full, then the tail of the " +
        "failing step — so a red leg is read instead of reproduced in this seat",
      usage: GITHUB_RUN_LOG_USAGE,
    },
  }),
  rerun: lazy({
    load: () => import("../commands/github/rerunRun.js").then((m) => m.githubRerunCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github rerun --repo owner/name --run-id 36945592960 --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Re-run a workflow run's failed jobs, or every failed run on a pull request's head, through the " +
        "door — confirmed by reading the run back at its next attempt",
      usage: GITHUB_RERUN_USAGE,
    },
  }),
  cycle: lazy({
    load: () => import("../commands/github/cycleRun.js").then((m) => m.githubCycleCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github cycle --repo owner/name --number 9876 --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Close and reopen a pull request through the door so its CI runs on a fresh merge commit — only once " +
        "refs/pull/N/merge is on the base's live tip, else write nothing (exit 4 while GitHub computes)",
      usage: GITHUB_CYCLE_USAGE,
    },
  }),
};
