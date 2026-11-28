/**
 * After `codex review` has finished every pass, remove the snapshot pool a description review's one-shot packet
 * repository minted, and report what became of it BESIDE the verdict.
 *
 * Only a description review's packet is eligible: `readPreparationAtRoot` finds its record, and the repository's
 * HEAD must be the commit that record wrote. An ordinary repository's pool is what its next pass reuses, so it is
 * never touched. The pool removed is the exact root the
 * passes' own acquires returned (`CompletedPass.snapshotPoolRoot`), never one rebuilt or found by listing, and
 * two different roots across the passes remove nothing. The removal itself is `codex/snapshotPoolReclaim.ts`.
 *
 * Nothing here feeds the verdict or the exit code (`./passReport.ts`): a pool left behind is disk, not a wrong
 * answer. The stdout field is bounded to a code and a message.
 */
import { errorMessage } from "#lib/errorMessage.js";
import type { Result } from "#lib/result.js";

import { runGitChecked } from "../../../codex/gitRun.js";
import type { CompletedPass } from "../../../codex/orchestrate.js";
import {
  type PoolReclaimed,
  reclaimSnapshotPool,
  type SnapshotPoolReclaimError,
} from "../../../codex/snapshotPoolReclaim.js";
import type { DescriptionReviewError } from "../../../outbound/github/descriptionReviewErrors.js";
import { readPreparationAtRoot } from "../../../outbound/github/descriptionReviewStore.js";
import type { DescriptionReviewPreparation } from "../../../outbound/github/descriptionReviewTypes.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { PassInvocation } from "./passRoute.js";

/** What became of a description review's one-shot pool. */
export type PoolReclaimOutcome =
  | { readonly kind: "reclaimed"; readonly freedBytes: number; readonly removedSlots: number }
  | {
      readonly kind: "not-attempted";
      readonly reason: "ordinary-repository" | "not-the-prepared-packet" | "no-acquired-pool";
    }
  | { readonly kind: "failed"; readonly error: { readonly code: string; readonly message: string } };

/** Which pool the passes name, read only from what their own acquires returned. */
export type PoolRootChoice =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly poolRoot: string }
  | { readonly kind: "inconsistent"; readonly roots: readonly string[] };

/**
 * The one pool every pooled pass of this review leased from — pure. Exact strings, never canonicalised: two
 * spellings that might name one directory are two authorities, and two authorities remove nothing.
 *
 * @param passes every completed pass of this review
 * @returns none when no pass leased a pooled snapshot, the one root, or every distinct root when they disagree
 */
export function poolRootToReclaim({ passes }: { passes: readonly CompletedPass[] }): PoolRootChoice {
  const roots = [
    ...new Set(passes.flatMap((pass) => (pass.snapshotPoolRoot === undefined ? [] : [pass.snapshotPoolRoot]))),
  ];
  if (roots.length === 0) {
    return { kind: "none" };
  }
  if (roots.length > 1) {
    return { kind: "inconsistent", roots };
  }
  return { kind: "one", poolRoot: roots[0]! };
}

/** What the pool policy reads, each effect a seam a unit test passes its own of. */
export interface PoolReclaimInputs {
  /** The state home whose preparations decide eligibility. */
  readonly home: string;
  /** The repository the review read. */
  readonly repoRoot: string;
  /** Every completed pass, after the whole fan-out has settled. */
  readonly passes: readonly CompletedPass[];
  readonly ledgerPath: string;
  readonly nowIso: () => string;
  /** The eligibility read; production passes `readPreparationAtRoot`. */
  readonly readPreparation?: (args: {
    home: string;
    repoRoot: string;
  }) => Result<DescriptionReviewPreparation | undefined, DescriptionReviewError>;
  /** The repository's current HEAD commit; production asks git. */
  readonly headOf?: (args: { repoRoot: string }) => string;
  /** The removal; production passes `reclaimSnapshotPool`. */
  readonly reclaim?: (args: {
    poolRoot: string;
    repoRoot: string;
    ledgerPath: string;
    nowIso: () => string;
    session: string;
  }) => Result<PoolReclaimed, SnapshotPoolReclaimError>;
}

/**
 * Remove this review's one-shot pool when its repository is a description-review packet, folding every result
 * into an outcome — a throw from any read or removal included, since a pool left behind never fails a review.
 *
 * @param inputs what the policy reads, each effect injectable
 * @returns reclaimed, not-attempted with why, or failed with a bounded code and message
 */
export function reclaimDescriptionReviewPool(inputs: PoolReclaimInputs): PoolReclaimOutcome {
  try {
    return decidePoolReclaim(inputs);
  } catch (error: unknown) {
    return { error: { code: "POOL_RECLAIM_THREW", message: errorMessage({ error }) }, kind: "failed" };
  }
}

/** The packet repository's HEAD, read from git. */
function gitHead({ repoRoot }: { repoRoot: string }): string {
  return runGitChecked({ args: ["rev-parse", "HEAD"], cwd: repoRoot, label: "git rev-parse HEAD" }).trim();
}

/**
 * The policy itself. A preparation record at this path is not enough: the repository's HEAD must be the commit
 * that preparation wrote, or the path holds some other repository whose pool its next pass reuses.
 */
function decidePoolReclaim({
  home,
  repoRoot,
  passes,
  ledgerPath,
  nowIso,
  readPreparation = readPreparationAtRoot,
  headOf = gitHead,
  reclaim = reclaimSnapshotPool,
}: PoolReclaimInputs): PoolReclaimOutcome {
  const preparation = readPreparation({ home, repoRoot });
  if (preparation.isErr()) {
    return { error: { code: preparation.error.code, message: preparation.error.message }, kind: "failed" };
  }
  if (preparation.value === undefined) {
    return { kind: "not-attempted", reason: "ordinary-repository" };
  }
  if (headOf({ repoRoot }) !== preparation.value.headSha) {
    return { kind: "not-attempted", reason: "not-the-prepared-packet" };
  }
  const choice = poolRootToReclaim({ passes });
  if (choice.kind === "none") {
    return { kind: "not-attempted", reason: "no-acquired-pool" };
  }
  if (choice.kind === "inconsistent") {
    return {
      error: {
        code: "POOL_ROOTS_DISAGREE",
        message: `the passes leased from ${String(choice.roots.length)} different pools, so none was removed`,
      },
      kind: "failed",
    };
  }
  const reclaimed = reclaim({
    ledgerPath,
    nowIso,
    poolRoot: choice.poolRoot,
    repoRoot,
    session: `description-review:${preparation.value.preparationId}`,
  });
  if (reclaimed.isErr()) {
    return { error: { code: reclaimed.error.code, message: reclaimed.error.message }, kind: "failed" };
  }
  return { freedBytes: reclaimed.value.freedBytes, kind: "reclaimed", removedSlots: reclaimed.value.removedSlots };
}

/**
 * The completed passes of a batch, in order — pure.
 *
 * @param invocations what each pass returned
 * @returns every pass that completed, refused and unrouted ones left out
 */
export function completedPassesOf({
  invocations,
}: {
  invocations: readonly PassInvocation[];
}): readonly CompletedPass[] {
  return invocations.flatMap((invocation) => (invocation.kind === "completed" ? [invocation.pass] : []));
}

/**
 * `codex review`'s one call once its whole fan-out has settled: the pool policy over this invocation's
 * completed passes, journalled into the home's reclaim ledger.
 *
 * @param clock the review's own runtime, whose clock stamps the ledger row
 * @param diff the frozen review diff, whose repository decides eligibility
 * @param home the state home
 * @param invocations what each pass returned
 * @returns what became of the pool
 */
export function reviewPoolReclaim({
  clock,
  diff,
  home,
  invocations,
}: {
  clock: { nowIso(): string };
  diff: { repoRoot: string };
  home: string;
  invocations: readonly PassInvocation[];
}): PoolReclaimOutcome {
  return reclaimDescriptionReviewPool({
    home,
    ledgerPath: stateHomePaths({ home }).homeReclaimLedgerJsonl,
    nowIso: () => clock.nowIso(),
    passes: completedPassesOf({ invocations }),
    repoRoot: diff.repoRoot,
  });
}

/** The stdout document's `snapshotPoolReclaim` field. */
export type PoolReclaimJson =
  | { readonly status: "reclaimed"; readonly freedBytes: number; readonly removedSlots: number }
  | { readonly status: "not-attempted"; readonly reason: string }
  | { readonly status: "failed"; readonly error: { readonly code: string; readonly message: string } };

/**
 * The outcome as the stdout document carries it — pure.
 *
 * @param outcome what became of the pool
 * @returns the bounded JSON shape
 */
export function poolReclaimJson({ outcome }: { outcome: PoolReclaimOutcome }): PoolReclaimJson {
  switch (outcome.kind) {
    case "reclaimed":
      return { freedBytes: outcome.freedBytes, removedSlots: outcome.removedSlots, status: "reclaimed" };
    case "not-attempted":
      return { reason: outcome.reason, status: "not-attempted" };
    case "failed":
      return { error: outcome.error, status: "failed" };
  }
}

/**
 * The stderr line for a failed removal, saying the verdict stands — pure. Every other outcome prints nothing.
 *
 * @param outcome what became of the pool
 * @returns the diagnostic lines, empty unless the removal failed
 */
export function poolReclaimFailureLines({ outcome }: { outcome: PoolReclaimOutcome }): readonly string[] {
  if (outcome.kind !== "failed") {
    return [];
  }
  return [
    `description review's snapshot pool not removed (${outcome.error.code}: ${outcome.error.message}) — the verdict stands`,
  ];
}
