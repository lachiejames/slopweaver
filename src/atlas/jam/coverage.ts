/**
 * Building and replacing Jam coverage cells.
 *
 * The cell shape and its constructors are the kit's. What this atlas adds is one field, `channel`, recorded
 * alongside the kit's `surface` because the same platform is reached through three independent channels and
 * each keeps its own coverage — see `model.ts` on why one succeeding must never erase what another knew, and
 * why the three carry unrelated visibility ceilings.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";

import { JAM_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type {
  JamArtifactRef,
  JamAtlasChannel,
  JamCoverageCell,
  JamCoverageState,
  JamEvidenceRole,
  JamSurface,
} from "./model.js";
import { jamVisibilityScopeFor } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function jamCoverageFreshness({ cell, nowMs }: { cell: JamCoverageCell; nowMs: number }): FreshnessAssessment {
  return coverageFreshness({ cell, nowMs, windowMs: atlasFreshnessWindowMs({ descriptor: JAM_ATLAS_DESCRIPTOR }) });
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
export function succeededJamCoverageCell({
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  artifacts,
  at,
}: {
  surface: JamSurface;
  channel: JamAtlasChannel;
  role: JamEvidenceRole;
  scope: string;
  state: JamCoverageState;
  reason: string;
  artifacts: readonly JamArtifactRef[];
  at: string;
}): JamCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: jamVisibilityScopeFor({ channel }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view — and it
  // narrows `surface` to this atlas's own five, which the kit's widened cell has already lost.
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    surface,
    visibilityScope: jamVisibilityScopeFor({ channel }),
  };
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward rather
 * than erased — a failed attempt must not make an earlier successful look disappear, only stop being current.
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
 *
 * @internal
 */
export function failedJamCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: JamCoverageCell | null;
  surface: JamSurface;
  channel: JamAtlasChannel;
  role: JamEvidenceRole;
  scope: string;
  state: JamCoverageState;
  reason: string;
  unblockedBy: string | null;
}): JamCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: jamVisibilityScopeFor({ channel }),
  });
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    surface,
    visibilityScope: jamVisibilityScopeFor({ channel }),
  };
}

/**
 * Replace one surface's cell, leaving every other surface's exactly as stored.
 *
 * The one operation both publishers perform on a stored cell list, and it is here rather than repeated at
 * each call site because filtering on the wrong field is how one channel's publish silently deletes the
 * other's coverage.
 *
 * @param cells the cells the store already holds
 * @param replacement the cell this run produced
 * @returns the cells with that one surface replaced
 *
 * @internal
 */
export function withJamCoverageCell({
  cells,
  replacement,
}: {
  cells: readonly JamCoverageCell[];
  replacement: JamCoverageCell;
}): readonly JamCoverageCell[] {
  return [...cells.filter((cell) => cell.surface !== replacement.surface), replacement];
}
