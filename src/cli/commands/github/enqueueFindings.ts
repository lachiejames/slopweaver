/**
 * `slopweaver github enqueue` — every reason NOT to queue a pull request, as pure functions: the
 * acknowledgeable findings, the refusals no acknowledgement can clear, and the remedy printed beside each.
 *
 * Split from `./enqueueCore.ts` on size alone, and that module's header is still the one that explains the
 * guard — why it acknowledges rather than judges, and why the CI half carries two subjects rather than one.
 * The review finding lives in `./enqueueReviewFinding.ts`, split from here on size the same way.
 *
 * Every branch-shaped judgement here is made against the EFFECTIVE landing branch `./enqueueTarget.ts`
 * computes, never `pr.baseRefName`: only the bottom member of a native stack targets the branch the stack
 * actually lands on, so for any member above it the two differ and the base ref names the member beneath.
 */

import { type CodexLoopInspection } from "../../../codex/landingGate.js";

import type { GithubChecksSnapshot } from "../../../live/github/checks.js";
import type { MergeQueuePrState, MergeQueueState } from "../../../live/github/mergeQueue.js";
import { requiredContextGate, requiredContextRefusal } from "../../../live/github/requiredContexts.js";
import { ciFinding } from "./ciFindings.js";
import { codexLoopFindingFor } from "./enqueueCodexLoop.js";
import { reviewFinding } from "./enqueueReviewFinding.js";
import type { EnqueueTarget } from "./enqueueTarget.js";

/**
 * The finding kinds this guard can raise. Each kind raises at most one finding, so the kind IS the subject.
 *
 * @internal named by this verb's own core, shell and tests; nothing else in the repo consumes it.
 */
export type EnqueueFindingKind =
  | "codex-loop-incomplete"
  | "ci-not-green"
  | "ci-rollup-superseded"
  | "review-not-approved"
  | "not-mergeable"
  | "required-context-missing";

/**
 * One reason not to queue this pull request, and the exact subject that acknowledges it.
 *
 * @internal the shape `enqueueFindings` returns; no caller outside this verb names it.
 */
export interface EnqueueFinding {
  readonly kind: EnqueueFindingKind;
  readonly subject: EnqueueFindingKind;
  readonly detail: string;
}

/** The mergeability finding, or none when GitHub reports the pull request mergeable. */
function mergeableFinding({ pr }: { pr: MergeQueuePrState }): readonly EnqueueFinding[] {
  if (pr.mergeable === "MERGEABLE") {
    return [];
  }
  const detail =
    pr.mergeable === "UNKNOWN"
      ? `GitHub has not finished computing whether #${String(pr.number)} merges cleanly — its mergeability reads UNKNOWN.`
      : `GitHub reports #${String(pr.number)} as ${pr.mergeable} against ${pr.baseRefName} — rebase it first.`;
  return [{ detail, kind: "not-mergeable", subject: "not-mergeable" }];
}

/**
 * The finding for a required context that never ran, or none when every required name is on the head.
 *
 * Separate from `ciFinding` because the rollup CANNOT see this one. `statusCheckRollup` summarises the runs
 * PRESENT on the head commit, so a required context that never registered is not a failure in it — it is
 * absent, and the rollup reads `SUCCESS` over whatever else did run. MEASURED
 * (`slopweaver github enqueue --pr <n> --repo <owner/repo> --dry-run --json`): a repository's
 * `main` requires exactly `build` and `integration`, both jobs of one workflow, and a pull request GitHub
 * reports as `CONFLICTING` runs that workflow not at all while `CodeQL` still passes and carries the rollup.
 */
function requiredContextFinding({
  checks,
  requiredContexts,
  baseRefName,
}: {
  checks: GithubChecksSnapshot;
  requiredContexts: readonly string[];
  baseRefName: string;
}): readonly EnqueueFinding[] {
  const gate = requiredContextGate({
    branch: baseRefName,
    checks: checks.checks,
    mergeable: checks.mergeable,
    required: requiredContexts,
    truncated: checks.truncated,
  });
  const refusal = requiredContextRefusal({ gate });
  if (refusal === undefined) {
    return [];
  }
  return [{ detail: refusal, kind: "required-context-missing", subject: "required-context-missing" }];
}

/**
 * Every acknowledgeable reason not to queue this pull request.
 *
 * @param pr the pull request's queue-relevant state as GitHub reports it
 * @param requiredContexts the status-check contexts the landing branch requires
 * @param requiresCodeOwnerReviews whether the base ENFORCES codeowners, `undefined` when it could not be read
 * @param inspection what the local checkout said about the Codex pairing floor
 * @param target where this pull request really lands — the stack's base for a native-stack member
 * @returns the findings, in a stable order
 */
export function enqueueFindings({
  pr,
  requiredContexts,
  requiresCodeOwnerReviews,
  inspection,
  target,
}: {
  pr: MergeQueuePrState;
  requiredContexts: readonly string[];
  requiresCodeOwnerReviews: boolean | undefined;
  inspection: CodexLoopInspection;
  target: EnqueueTarget;
}): readonly EnqueueFinding[] {
  const ci = ciFinding({ checks: pr.checks, number: pr.number, requiredContexts });
  const contexts = requiredContextFinding({ baseRefName: target.branch, checks: pr.checks, requiredContexts });
  const ciProvenGreen = ci.length === 0 && contexts.length === 0;
  return [
    ...codexLoopFindingFor({ inspection }),
    ...ci,
    ...contexts,
    ...reviewFinding({ branch: target.branch, ciProvenGreen, pr, requiresCodeOwnerReviews }),
    ...mergeableFinding({ pr }),
  ];
}

/**
 * Every reason this pull request cannot be queued AT ALL, which no acknowledgement can clear.
 *
 * @param pr the pull request's queue-relevant state as GitHub reports it
 * @param queue the landing branch's merge queue, or `undefined` when it has none
 * @param repo the `owner/name` slug, named in the no-queue refusal
 * @param target where this pull request really lands — the stack's base for a native-stack member
 * @param requiredContexts the status-check contexts the base requires; empty means the queue gates on nothing
 * @returns one refusal line per blocking state
 */
export function enqueueRefusals({
  pr,
  queue,
  repo,
  target,
  requiredContexts,
}: {
  pr: MergeQueuePrState;
  queue: MergeQueueState | undefined;
  repo: string;
  target: EnqueueTarget;
  requiredContexts: readonly string[];
}): readonly string[] {
  const refusals: string[] = [];
  if (pr.state !== "OPEN") {
    refusals.push(
      `#${String(pr.number)} is ${pr.state}, not open — nothing to queue. If it merged already, pull ${pr.baseRefName}.`,
    );
  }
  if (pr.isDraft) {
    refusals.push(
      `#${String(pr.number)} is still a DRAFT, and GitHub will not queue one. Undraft it with ` +
        "`slopweaver github ready` first.",
    );
  }
  if (queue === undefined) {
    refusals.push(
      `${repo} has no merge queue on ${target.branch}, so there is no 'Merge when ready' to press. Land it ` +
        "with `slopweaver github merge --admin --number <n>` instead, or enable a merge queue on that branch.",
    );
  }
  if (queue !== undefined && requiredContexts.length === 0) {
    refusals.push(
      `${repo}'s queue on ${target.branch} requires NO status-check contexts, so it would merge this pull ` +
        "request on arrival without testing the merged result. Tick 'Require status checks to pass before " +
        `merging' on ${target.branch} and name the contexts the queue must wait for, or land it with ` +
        "`slopweaver github merge --admin --number <n>` instead.",
    );
  }
  return refusals;
}

/**
 * Findings not covered by either acknowledgement mechanism.
 *
 * @param findings every finding the guard produced
 * @param acknowledge exact subjects the caller accepted individually
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @returns the findings still standing between this invocation and the write
 */
export function unacknowledgedEnqueueFindings({
  findings,
  acknowledge,
  acknowledgeAll,
}: {
  findings: readonly EnqueueFinding[];
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
}): readonly EnqueueFinding[] {
  if (acknowledgeAll) {
    return [];
  }
  const accepted = new Set(acknowledge);
  return findings.filter((finding) => !accepted.has(finding.subject));
}

/** A short, actionable remedy per finding kind — printed alongside every finding of that kind. */
const REMEDY_BY_KIND: Readonly<Record<EnqueueFindingKind, string>> = {
  "codex-loop-incomplete":
    "run the pairing the standing rule asks for — `slopweaver codex plan` before the work and " +
    "`slopweaver codex review` over the finished diff — and read `slopweaver codex status` for the whole " +
    'picture. To land anyway, acknowledge `codex-loop-incomplete` WITH --reason "…", which is written to the ' +
    "door ledger. When Codex is CAPPED, or no Codex plan is registered, a visible Claude session takes the plan before the work " +
    "(`codex plan-fallback`) and the review after it (`codex review-fallback`); only work begun with no plan " +
    "rides that acknowledgement — nothing waits on Codex",
  "ci-not-green":
    "wait with `slopweaver github checks --wait`, or acknowledge this — a merge queue re-runs the required " +
    "checks on the merged result anyway, so queueing while they run is the ordinary case",
  "ci-rollup-superseded":
    "open each named run and confirm it is one your OWN re-run replaced, then acknowledge " +
    "`ci-rollup-superseded` with a `--reason` naming that replacement run — never `ci-not-green`, which is " +
    "the subject that would also wave through a red still standing on the head. `github landing --press` " +
    "answers this one for itself whenever the read can PROVE the replacement",
  "not-mergeable": "rebase the branch onto its base, or wait for GitHub to finish computing mergeability",
  "required-context-missing":
    "rebase the branch, or re-trigger the workflow that owns the missing context, then re-read — do NOT " +
    "acknowledge this to get past a rollup that reads green, which is exactly what a required context that " +
    "never ran looks like",
  "review-not-approved":
    "get the review the base branch requires, or acknowledge this where the sole codeowner is the sole " +
    "author and the approval can never arrive",
};

/**
 * The remedy text for one finding kind.
 *
 * @param kind the finding kind
 * @returns the remedy sentence
 */
export function enqueueRemedyFor({ kind }: { kind: EnqueueFindingKind }): string {
  return REMEDY_BY_KIND[kind];
}

/**
 * Every finding, each line stating its subject, detail, remedy and acknowledgement state.
 *
 * Every finding is printed regardless of whether it is acknowledged — acknowledging silences the REFUSAL,
 * never the visibility of what was accepted.
 *
 * @param findings every finding the guard produced
 * @param acknowledge exact subjects the caller accepted individually
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @param stacked whether the subject is a native-stack member, whose clean verdict covers only ITSELF
 * @returns the lines to print
 */
export function enqueueReportLines({
  findings,
  acknowledge,
  acknowledgeAll,
  stacked,
}: {
  findings: readonly EnqueueFinding[];
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
  stacked: boolean;
}): readonly string[] {
  if (findings.length === 0) {
    return [
      stacked
        ? "clean: no unacknowledged findings on the SELECTED pull request. GitHub also checks the unmerged " +
          "pull requests below it in the stack, which this report did not read."
        : "clean: nothing stands between this pull request and its base branch's merge queue.",
    ];
  }
  const accepted = new Set(acknowledge);
  const lines: string[] = [];
  for (const finding of findings) {
    const isAcknowledged = acknowledgeAll || accepted.has(finding.subject);
    lines.push(`  [${isAcknowledged ? "ACKNOWLEDGED" : "UNACKNOWLEDGED"}] ${finding.subject}`);
    lines.push(`      ${finding.detail}`);
    lines.push(`      remedy: ${enqueueRemedyFor({ kind: finding.kind })}`);
  }
  return lines;
}
