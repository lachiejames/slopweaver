/**
 * Building and reading Xero coverage cells.
 *
 * The cell shape and its constructors are the kit's. What this atlas adds is one field, `channel`, recorded
 * alongside the kit's `surface` because the same platform is reached through two independent channels and
 * each keeps its own coverage — see `model.ts` on why one succeeding must never erase what the other knew.
 *
 * The visibility scope is derived from the SURFACE rather than passed in, and rather than derived from the
 * channel as the Notion atlas does it: two of this atlas's surfaces share the `api` channel and read under
 * completely unrelated ceilings — `sdk-declared` reads a package on disk and `live-api` would read a tenant
 * over OAuth — so a caller free to supply the scope is a caller free to mislabel one of them.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";

import { XERO_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  type XeroArtifactRef,
  type XeroAtlasChannel,
  type XeroCoverageCell,
  type XeroCoverageState,
  type XeroCoverageSurface,
  type XeroEvidenceRole,
  xeroVisibilityScopeFor,
} from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function xeroCoverageFreshness({ cell, nowMs }: { cell: XeroCoverageCell; nowMs: number }): FreshnessAssessment {
  return coverageFreshness({ cell, nowMs, windowMs: atlasFreshnessWindowMs({ descriptor: XERO_ATLAS_DESCRIPTOR }) });
}

/**
 * Build a coverage cell for an acquisition attempt that succeeded.
 *
 * @param surface the surface this cell covers, which also decides the claim boundary it carries
 * @param channel which channel produced this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned
 * @param reason why, in English
 * @param artifacts the evidence backing this look
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function succeededXeroCoverageCell({
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  artifacts,
  at,
}: {
  surface: XeroCoverageSurface;
  channel: XeroAtlasChannel;
  role: XeroEvidenceRole;
  scope: string;
  state: XeroCoverageState;
  reason: string;
  artifacts: readonly XeroArtifactRef[];
  at: string;
}): XeroCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: xeroVisibilityScopeFor({ surface }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    surface,
    visibilityScope: xeroVisibilityScopeFor({ surface }),
  };
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward rather
 * than erased — a failed attempt must not make an earlier successful look disappear, only stop being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface has never been touched
 * @param surface the surface this cell covers, which also decides the claim boundary it carries
 * @param channel which channel attempted this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedXeroCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: XeroCoverageCell | null;
  surface: XeroCoverageSurface;
  channel: XeroAtlasChannel;
  role: XeroEvidenceRole;
  scope: string;
  state: XeroCoverageState;
  reason: string;
  unblockedBy: string | null;
}): XeroCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: xeroVisibilityScopeFor({ surface }),
  });
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    surface,
    visibilityScope: xeroVisibilityScopeFor({ surface }),
  };
}

/**
 * The cell a kind file already holds for one surface, which a failed attempt carries its prior success from.
 *
 * The surface set is closed, so a miss is never a misspelt key: it means this surface has never been touched,
 * which is exactly the `null` `failedXeroCoverageCell` takes as its `previous`.
 *
 * @param coverage the cells the stored kind file holds
 * @returns the stored cell for that surface, or `null` when no attempt on it was ever recorded
 */
export function storedXeroCoverageCell({
  coverage,
  surface,
}: {
  coverage: readonly XeroCoverageCell[];
  surface: XeroCoverageSurface;
}): XeroCoverageCell | null {
  const cell = coverage.find((entry) => entry.surface === surface);
  if (cell === undefined) {
    return null;
  }
  return cell;
}
