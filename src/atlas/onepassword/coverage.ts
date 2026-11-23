/**
 * Building and reading this atlas's coverage cells.
 *
 * The cell shape and its constructors are the kit's. What this atlas adds is one field: `channel`, recorded
 * alongside the kit's `surface` because the same platform is reached through three independent channels and
 * each keeps its own coverage — one succeeding must never erase what another already knew.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";
import { ONEPASSWORD_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type {
  OnepasswordArtifactRef,
  OnepasswordChannel,
  OnepasswordCoverageCell,
  OnepasswordCoverageState,
  OnepasswordEvidenceRole,
} from "./model.js";
import { ONEPASSWORD_VISIBILITY_SCOPE } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function onepasswordCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: OnepasswordCoverageCell;
  nowMs: number;
}): FreshnessAssessment {
  return coverageFreshness({
    cell,
    nowMs,
    windowMs: atlasFreshnessWindowMs({ descriptor: ONEPASSWORD_ATLAS_DESCRIPTOR }),
  });
}

/**
 * Build a coverage cell for an acquisition attempt that succeeded.
 *
 * @param surface the surface this cell covers
 * @param channel which channel produced this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned
 * @param reason why, in English
 * @param artifacts the evidence backing this look
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function succeededOnepasswordCoverageCell({
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  artifacts,
  at,
}: {
  surface: string;
  channel: OnepasswordChannel;
  role: OnepasswordEvidenceRole;
  scope: string;
  state: OnepasswordCoverageState;
  reason: string;
  artifacts: readonly OnepasswordArtifactRef[];
  at: string;
}): OnepasswordCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: ONEPASSWORD_VISIBILITY_SCOPE,
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: ONEPASSWORD_VISIBILITY_SCOPE };
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward rather
 * than erased — a failed attempt must not make an earlier successful look disappear, only stop being
 * current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface was never touched
 * @param surface the surface this cell covers
 * @param channel which channel attempted this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedOnepasswordCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: OnepasswordCoverageCell | null;
  surface: string;
  channel: OnepasswordChannel;
  role: OnepasswordEvidenceRole;
  scope: string;
  state: OnepasswordCoverageState;
  reason: string;
  unblockedBy: string | null;
}): OnepasswordCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: ONEPASSWORD_VISIBILITY_SCOPE,
  });
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: ONEPASSWORD_VISIBILITY_SCOPE };
}

/**
 * The cell one surface already holds on one channel — the `previous` a failed attempt carries forward.
 *
 * @param coverage the kind's coverage as it stood before this run
 * @returns that cell, or `null` when this is the surface's first attempt on this channel: nothing was ever
 *   recorded, so there is no prior success to keep
 */
export function findCoverageCell({
  coverage,
  surface,
  channel,
}: {
  coverage: readonly OnepasswordCoverageCell[];
  surface: string;
  channel: OnepasswordChannel;
}): OnepasswordCoverageCell | null {
  const held = coverage.find((cell) => cell.surface === surface && cell.channel === channel);
  if (held === undefined) {
    return null;
  }
  return held;
}
