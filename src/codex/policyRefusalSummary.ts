/**
 * The cyber-policy refusal as its own class with a count — what `codex status` prints on its `REFUSED:` line.
 *
 * Before this, a refused pass read as one more `FATAL` row and its fallback read as a cap: the three fallbacks
 * taken were prepared under `SLOPWEAVER_ALLOW_FALLBACK_REVIEW_UNCAPPED=1` and recorded
 * "no fleet-wide cap was read" as their cap evidence. So the refusal rate was invisible from every surface
 * that exists to show it. Classification is at READ time (`./policyRefusal.ts`), from the cause each record
 * already carries, so every historical record counts too — and none of them grounds a fallback
 * (`./policyFallback.ts` wants the retry, which they predate).
 *
 * Repro of the window this counts: `slopweaver codex status` on any branch; the pass records it reads are
 * `grep -l 'flagged for possible cybersecurity' "$SLOPWEAVER_HOME"/orchestration/*\/record.json`.
 *
 * Pure: records and receipts in, counts out.
 */

import type { ClaudeFallbackReviewReceipt } from "./fallbackReview.js";
import { POLICY_REFUSAL_REVIEW_MODE } from "./policyFallback.js";
import { transportFaultRefusal } from "./policyRefusal.js";
import type { CodexArtifactRecord, CodexAttempt } from "./types.js";

/** How far back the summary looks: a week, the span a rate over "today" alone cannot show a trend across. */
const POLICY_REFUSAL_WINDOW_DAYS = 7;

/** The refusal class's counts over the window. */
export interface PolicyRefusalSummary {
  /** Attempts the filter ended — an initial and a retry on the same pass count twice. */
  readonly refusedAttempts: number;
  /** Passes with at least one refused attempt. */
  readonly affectedPasses: number;
  /** Affected passes that still reached an answer — on the one retry. */
  readonly rescuedPasses: number;
  /** Affected passes whose one policy retry was refused too: each one grounds a Claude fallback. */
  readonly twiceRefusedPasses: number;
  /** Claude fallback reviews completed on the refusal ground in the window. */
  readonly completedFallbacks: number;
  /** Twice-refused passes on the reported checkout and branch no Claude fallback has answered yet. */
  readonly twiceRefusedHere: readonly string[];
}

/** How many of a record's attempts the filter ended, counting a legacy record by its outcome alone. */
function refusedAttemptCount({ record }: { record: CodexArtifactRecord }): number {
  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  const byAttempt = attempts.filter((attempt) => transportFaultRefusal({ cause: attempt.cause }) !== null).length;
  if (byAttempt > 0) {
    return byAttempt;
  }
  // A record written before attempts carried their own cause says so only on its fatal outcome.
  const outcomeRefused =
    record.outcome.kind === "fatal" && transportFaultRefusal({ cause: record.outcome.cause }) !== null;
  return outcomeRefused ? 1 : 0;
}

/**
 * Count the cyber-policy refusal class over the last {@link POLICY_REFUSAL_WINDOW_DAYS} days.
 *
 * @param records every pass record the scan read
 * @param receipts every bound Claude fallback review receipt
 * @param repoRoot the checkout being reported on, for {@link PolicyRefusalSummary.twiceRefusedHere}
 * @param branch the branch being reported on
 * @param nowIso the instant the window ends at
 * @returns the counts; all zero when nothing in the window was refused
 */
export function summarizePolicyRefusals({
  records,
  receipts,
  repoRoot,
  branch,
  nowIso,
}: {
  records: readonly CodexArtifactRecord[];
  receipts: readonly ClaudeFallbackReviewReceipt[];
  repoRoot: string;
  branch: string;
  nowIso: string;
}): PolicyRefusalSummary {
  const since = Date.parse(nowIso) - POLICY_REFUSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = ({ iso }: { iso: string }): boolean => Date.parse(iso) >= since;
  const answeredByFallback = new Set(
    receipts.flatMap((receipt) =>
      receipt.request.mode === POLICY_REFUSAL_REVIEW_MODE ? [receipt.request.ground.artifactId] : [],
    ),
  );
  const affected = records
    .filter((record) => inWindow({ iso: record.createdAtIso }))
    .map((record) => ({ record, refused: refusedAttemptCount({ record }) }))
    .filter(({ refused }) => refused > 0);
  const twiceRefused = affected.filter(({ record }) => retryRefusedOnPolicy({ record }));
  const twiceRefusedHere = twiceRefused
    .filter(({ record }) => record.repoRoot === repoRoot && record.tree?.branch === branch)
    .map(({ record }) => record.artifactId)
    .filter((artifactId) => !answeredByFallback.has(artifactId));
  const completedFallbacks = receipts.filter(
    (receipt) => receipt.request.mode === POLICY_REFUSAL_REVIEW_MODE && inWindow({ iso: receipt.completedAtIso }),
  ).length;
  return {
    affectedPasses: affected.length,
    completedFallbacks,
    refusedAttempts: affected.reduce((sum, { refused }) => sum + refused, 0),
    rescuedPasses: affected.filter(({ record }) => record.outcome.kind === "answered").length,
    twiceRefusedHere: twiceRefusedHere.toSorted(),
    twiceRefusedPasses: twiceRefused.length,
  };
}

/** Whether the pass's one policy retry was refused too — the ground a refusal fallback stands on. */
function retryRefusedOnPolicy({ record }: { record: CodexArtifactRecord }): boolean {
  // The store's decode is shallow, so an old or hand-edited record may carry no attempts array at all.
  const attempts: readonly CodexAttempt[] = Array.isArray(record.attempts) ? record.attempts : [];
  return attempts.some(
    (attempt) => attempt.kind === "policy-retry" && transportFaultRefusal({ cause: attempt.cause }) !== null,
  );
}

/**
 * The `REFUSED:` lines `codex status` prints, or none when the window holds no refusal.
 *
 * @param summary the counts to render
 * @returns the lines, in order
 */
export function renderPolicyRefusalLines({ summary }: { summary: PolicyRefusalSummary }): readonly string[] {
  if (summary.affectedPasses === 0) {
    return [];
  }
  const lines = [
    `REFUSED: ${String(summary.affectedPasses)} pass(es) hit OpenAI's cyber-policy refusal in the last ` +
      `${String(POLICY_REFUSAL_WINDOW_DAYS)} days (${String(summary.refusedAttempts)} refused attempt(s)): ` +
      `${String(summary.rescuedPasses)} answered on the one retry, ${String(summary.twiceRefusedPasses)} ` +
      `refused twice, ${String(summary.completedFallbacks)} Claude fallback review(s) taken on that ground`,
  ];
  for (const artifactId of summary.twiceRefusedHere) {
    lines.push(
      `REFUSED: pass ${artifactId} on this branch was refused twice — a visible Claude session takes it: ` +
        `slopweaver codex review-fallback prepare --after-refusal ${artifactId} …`,
    );
  }
  return lines;
}
