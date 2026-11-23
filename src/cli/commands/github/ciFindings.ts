/**
 * The CI half of `github enqueue`'s findings, and the remedy sentence both of them end on.
 *
 * Split out of `./enqueueFindings.ts` so the CI family — which knows about rollups, superseded suites and
 * how a red leg is READ — sits apart from the review, mergeability and required-context families it shares
 * a report with. The remedy is the reason the split is here rather than anywhere else: it names a verb, and
 * a remedy that drifts from the verb it names is worse than none.
 */

import { type GithubChecksSnapshot, summarizeChecks } from "../../../live/github/checks.js";
import type { GithubCheck } from "../../../live/github/checksDedupe.js";
import {
  describeSupersededCheck,
  rollupContradictsChecks,
  supersededFailures,
} from "../../../live/github/rollupSupersession.js";
import { advisoryOnlyNames } from "../../../review/gatingChecks.js";
import type { EnqueueFinding } from "./enqueueFindings.js";

/**
 * The command that reads what a red leg actually printed, named in every CI finding's own detail.
 *
 * It is here rather than left to the reader because of the failure this closes. MEASURED: with
 * no log verb in the surface, two seats meeting a CI finding inside one hour both reached for the only
 * thing they could see — running the whole `yarn lint` lane in their own worktree — which is the offload
 * AGENTS.md § Toolchain forbids. A finding that names the RED without naming the read leaves the
 * local lane as the shortest path, so the remedy travels with the finding.
 *
 * @param number the pull request this finding is about
 * @returns the sentence appended to a CI finding's detail
 */
export function readTheLogClause({ number }: { number: number }): string {
  return (
    `  Read what the failed checks printed with \`slopweaver github checks --number ${String(number)} --log\` ` +
    "(or `github run-log <run-id>`) — never by running the lane in this seat."
  );
}

/** Check names in one state, comma-joined, or the empty string when none are in it. */
function namesInState({ checks, state }: { checks: readonly GithubCheck[]; state: GithubCheck["state"] }): string {
  return checks
    .filter((check) => check.state === state)
    .map((check) => check.name)
    .join(", ");
}

/**
 * The finding for a rollup pinned by a run that no longer exists in the latest-per-name view, or none when
 * that is not what this snapshot shows.
 *
 * Its own subject, deliberately NOT `ci-not-green`, and that split is the whole point rather than a
 * taxonomy preference. A superseded failure is the routine cost of the landing sequence itself — `github
 * push` amends the commit, repointing the proof anchor re-triggers the gate, and `github ready` re-triggers
 * it again — so on this repository it is the case a session meets most often and would learn to wave
 * through. Sharing a subject with a LIVE red would mean the reflex that clears the routine one also clears
 * the finding whose whole job is to catch a real failure. With two subjects, the habitual acknowledgement
 * (`ci-rollup-superseded`) cannot reach a red check that is still standing on the head.
 *
 * Raised only when at least one superseded run actually FAILED. A green head under a failing rollup with
 * nothing behind it is unexplained, and an unexplained disagreement keeps the sharper subject.
 */
function supersededRollupFinding({
  checks,
  number,
}: {
  checks: GithubChecksSnapshot;
  number: number;
}): readonly EnqueueFinding[] {
  const summary = summarizeChecks({ checks: checks.checks });
  if (!rollupContradictsChecks({ snapshot: checks, summary })) {
    return [];
  }
  const pinning = supersededFailures({ snapshot: checks });
  if (pinning.length === 0) {
    return [];
  }
  const noun = pinning.length === 1 ? "run is" : "runs are";
  return [
    {
      detail:
        `GitHub's rollup on ${checks.headSha} reads ${checks.rollupState}, but all ` +
        `${String(summary.total)} checks on that head PASSED. The rollup folds in every check suite on the ` +
        `commit, superseded ones included, and ${String(pinning.length)} superseded ${noun} still pinning ` +
        `it: ${pinning.map((check) => describeSupersededCheck({ check })).join("; ")}.` +
        readTheLogClause({ number }),
      kind: "ci-rollup-superseded",
      subject: "ci-rollup-superseded",
    },
  ];
}

/**
 * The CI finding, or none when GitHub's own rollup says every check on the head passed — or when every check
 * that did not pass is one the queue does not gate on.
 *
 * **An advisory-only red raises nothing**, because the merge queue gates on the base's required contexts and
 * nothing else. A finding raised on them would be `ci-not-green`, a subject `github landing --press` never answers, so
 * even a read that selected one pull request would be refused here over three red `Advisory
 * local browser E2E` lanes. "Advisory" is `advisoryOnlyNames` (`../../../review/gatingChecks.ts`) — the rule
 * the landing read's `ci-green` test proves the same thing by — and the identity block still names those reds
 * (`./enqueueCore.ts`), so passing them is never silent.
 *
 * @param checks the rollup snapshot already read for this head
 * @param requiredContexts the status-check contexts the landing branch requires
 * @returns the one CI finding, or an empty list when nothing about CI stands in the way
 */
export function ciFinding({
  checks,
  number,
  requiredContexts,
}: {
  checks: GithubChecksSnapshot;
  number: number;
  requiredContexts: readonly string[];
}): readonly EnqueueFinding[] {
  const summary = summarizeChecks({ checks: checks.checks });
  if (checks.rollupState === "SUCCESS" && summary.failed === 0 && summary.running === 0 && summary.queued === 0) {
    return [];
  }
  if (advisoryOnlyNames({ checks: checks.checks, requiredContexts, truncated: checks.truncated }) !== undefined) {
    return [];
  }
  const superseded = supersededRollupFinding({ checks, number });
  if (superseded.length > 0) {
    return superseded;
  }
  const failed = namesInState({ checks: checks.checks, state: "failed" });
  const failedPart = failed.length === 0 ? "" : `  failed: ${failed}.`;
  return [
    {
      detail:
        `GitHub's rollup on ${checks.headSha} reads ${checks.rollupState} — ` +
        `${String(summary.passed)}/${String(summary.total)} passed, ${String(summary.failed)} failed, ` +
        `${String(summary.running + summary.queued)} still running.${failedPart}` +
        readTheLogClause({ number }),
      kind: "ci-not-green",
      subject: "ci-not-green",
    },
  ];
}
