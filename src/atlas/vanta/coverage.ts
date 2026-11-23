/**
 * Building and reading Vanta coverage cells.
 *
 * The cell shape and its constructors are the kit's. What Vanta adds is one field: `channel`, recorded
 * alongside the kit's `surface` because this atlas reaches the same surface through two independent
 * channels and each keeps its own coverage — see `model.ts`'s header on why one succeeding must never
 * erase what the other knew.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import type {
  VantaArtifactRef,
  VantaChannel,
  VantaCoverageCell,
  VantaCoverageState,
  VantaEvidenceRole,
} from "./model.js";
import { vantaVisibilityScopeFor } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 */
export function vantaCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: VantaCoverageCell;
  nowMs: number;
}): FreshnessAssessment {
  return coverageFreshness({ cell, nowMs });
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
export function succeededVantaCoverageCell({
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
  channel: VantaChannel;
  role: VantaEvidenceRole;
  scope: string;
  state: VantaCoverageState;
  reason: string;
  artifacts: readonly VantaArtifactRef[];
  at: string;
}): VantaCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: vantaVisibilityScopeFor({ channel }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: vantaVisibilityScopeFor({ channel }) };
}

/**
 * The cell a stored kind file already holds for one surface, or `null` when it has never held one.
 *
 * Named rather than coalesced because the two cases are different facts — "this surface has failed before"
 * and "this surface has never been looked at" — and {@link failedVantaCoverageCell}'s `previous` parameter
 * treats them differently: the first carries a prior success forward, the second has none to carry.
 *
 * @param cells the coverage cells the store holds for this kind
 * @param surface which surface's cell is wanted
 * @returns the stored cell, or `null`
 */
export function previousVantaCoverageCell({
  cells,
  surface,
}: {
  cells: readonly VantaCoverageCell[];
  surface: string;
}): VantaCoverageCell | null {
  const held = cells.find((existing) => existing.surface === surface);
  if (held === undefined) {
    return null;
  }
  return held;
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward
 * rather than erased — a failed attempt must not make an earlier successful look disappear, only stop
 * being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface has never been touched
 * @param surface the surface this cell covers
 * @param channel which channel attempted this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedVantaCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: VantaCoverageCell | null;
  surface: string;
  channel: VantaChannel;
  role: VantaEvidenceRole;
  scope: string;
  state: VantaCoverageState;
  reason: string;
  unblockedBy: string | null;
}): VantaCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: vantaVisibilityScopeFor({ channel }),
  });
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: vantaVisibilityScopeFor({ channel }) };
}
