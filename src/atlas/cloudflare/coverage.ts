/**
 * Building and reading Cloudflare coverage cells.
 *
 * The freshness JUDGEMENT is the kit's ({@link coverageFreshness}), fed a cell through the kit's own
 * minimal {@link FreshnessBearingCell}. The CONSTRUCTORS below are not, and that is a finding rather than an
 * oversight: this atlas's stored cell predates `kit/coverage.ts` and carries no `surface`, `role` or
 * `artifacts`, because Cloudflare has exactly one channel and one evidence role and a cell was written to
 * carry neither. `cloudflareCoverageCellSchema` is `.strict()`, so building through the kit's constructors
 * would either write three fields the schema refuses or force them into it — an on-disk layout change, which
 * is a schema bump, which is a forced `cloudflare reset` on every install that already has data. Twenty
 * lines of local constructors is the cheaper half of that trade.
 *
 * What would change it is the driven-browser surface: a second surface makes `surface` and `role` load-
 * bearing rather than constant, and THAT is the change worth a schema bump — see `descriptor.ts`.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { coverageFreshness, type FreshnessBearingCell } from "../kit/coverage.js";
import { CLOUDFLARE_FRESHNESS_WINDOW_MS, type CloudflareFreshnessAssessment } from "./freshness.js";
import { CLOUDFLARE_VISIBILITY_SCOPE, type CloudflareCoverageState } from "./model.js";

/** One coverage cell, as `model.ts`'s `cloudflareCoverageCellSchema` shapes it. */
export interface CloudflareCoverageCell extends FreshnessBearingCell {
  readonly reason: string;
  readonly scope: string;
  readonly state: CloudflareCoverageState;
  readonly unblockedBy: string | null;
  readonly visibilityScope: typeof CLOUDFLARE_VISIBILITY_SCOPE;
}

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 */
export function cloudflareCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: CloudflareCoverageCell;
  nowMs: number;
}): CloudflareFreshnessAssessment {
  return coverageFreshness({ cell, nowMs, windowMs: CLOUDFLARE_FRESHNESS_WINDOW_MS });
}

/**
 * Build a coverage cell for an acquisition attempt that succeeded.
 *
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function succeededCloudflareCoverageCell({
  scope,
  state,
  reason,
  at,
}: {
  scope: string;
  state: CloudflareCoverageState;
  reason: string;
  at: string;
}): CloudflareCoverageCell {
  return {
    lastSuccessAt: at,
    latestAttemptFailed: false,
    reason,
    scope,
    state,
    unblockedBy: null,
    visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
  };
}

/**
 * The cell a scope was last recorded under, before this attempt — `null` when this scope has never been
 * attempted, which is what {@link failedCloudflareCoverageCell} reads as "no prior success to carry forward".
 *
 * @param coverage every cell the kind file already holds
 * @param scope the concrete scope this attempt is for
 * @returns the stored cell for that scope, or `null` for a scope with no history yet
 */
export function priorCoverageCell({
  coverage,
  scope,
}: {
  coverage: readonly CloudflareCoverageCell[];
  scope: string;
}): CloudflareCoverageCell | null {
  const cell = coverage.find((existing) => existing.scope === scope);
  if (cell === undefined) {
    return null;
  }
  return cell;
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward rather
 * than erased — a failed attempt must not make an earlier successful look disappear, only stop being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface has never been touched
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedCloudflareCoverageCell({
  previous,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: CloudflareCoverageCell | null;
  scope: string;
  state: CloudflareCoverageState;
  reason: string;
  unblockedBy: string | null;
}): CloudflareCoverageCell {
  return {
    lastSuccessAt: unsetFieldAsNull({ key: "lastSuccessAt", record: previous }),
    latestAttemptFailed: true,
    reason,
    scope,
    state,
    unblockedBy,
    visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
  };
}

/**
 * Whether one cell, on its own, is usable as a source of record.
 *
 * @param cell the cell to judge
 * @returns `true` only for a synced cell
 */
export function isUsableCloudflareCoverageCell({ cell }: { cell: CloudflareCoverageCell }): boolean {
  return cell.state === "synced";
}

/**
 * Whether at least one cell in a set is usable — the exit-0 condition for a sync.
 *
 * @param cells every cell to check
 * @returns `true` if any cell is a synced source of record
 */
export function hasUsableCloudflareCoverage({ cells }: { cells: readonly CloudflareCoverageCell[] }): boolean {
  return cells.some((cell) => isUsableCloudflareCoverageCell({ cell }));
}
