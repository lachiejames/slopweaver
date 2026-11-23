/**
 * Building and reading Trelica coverage cells.
 *
 * The cell shape and its constructors are the kit's. What this atlas adds is one field, `channel`, recorded
 * alongside the kit's `surface` because the same kind is reached through three independent channels and each
 * keeps its own coverage — see `model.ts` on why one succeeding must never erase what another knew.
 * {@link withTrelicaCoverageCell} keys on the surface alone, so it ASSUMES no two channels write the same surface
 * name on one kind. Nothing in this file enforces that: a cell reusing another channel's surface name replaces
 * that channel's cell.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";

import { TRELICA_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type {
  TrelicaArtifactRef,
  TrelicaAtlasChannel,
  TrelicaCoverageCell,
  TrelicaCoverageState,
  TrelicaEvidenceRole,
} from "./model.js";
import { trelicaVisibilityScopeFor } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function trelicaCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: TrelicaCoverageCell;
  nowMs: number;
}): FreshnessAssessment {
  return coverageFreshness({ cell, nowMs, windowMs: atlasFreshnessWindowMs({ descriptor: TRELICA_ATLAS_DESCRIPTOR }) });
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
export function succeededTrelicaCoverageCell({
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
  channel: TrelicaAtlasChannel;
  role: TrelicaEvidenceRole;
  scope: string;
  state: TrelicaCoverageState;
  reason: string;
  artifacts: readonly TrelicaArtifactRef[];
  at: string;
}): TrelicaCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: trelicaVisibilityScopeFor({ channel }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: trelicaVisibilityScopeFor({ channel }) };
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
export function failedTrelicaCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: TrelicaCoverageCell | null;
  surface: string;
  channel: TrelicaAtlasChannel;
  role: TrelicaEvidenceRole;
  scope: string;
  state: TrelicaCoverageState;
  reason: string;
  unblockedBy: string | null;
}): TrelicaCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: trelicaVisibilityScopeFor({ channel }),
  });
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: trelicaVisibilityScopeFor({ channel }) };
}

/**
 * Replace one surface's cell on a kind's coverage list, leaving every other surface's exactly as it was.
 *
 * Every publisher here writes at least two cells onto files another publisher also writes, and doing that
 * by hand three times is how one of them ends up filtering on the wrong key. Filtering on the SURFACE
 * rather than the channel is deliberate: one channel may own several surfaces on one kind — the published
 * API owns both its declared map and the separate claim about whether its data is reachable — and keying
 * on the channel would let the second overwrite the first. The SCOPE is not part of the key: every publisher here
 * writes one scope per surface on a kind file, so a cell whose scope changed replaces the old one rather than
 * leaving it standing beside the new one as a second, stale claim about the same surface.
 *
 * @param cells the coverage list as the store holds it
 * @param replacement the cell to install
 * @returns the list with that surface's cell replaced
 */
export function withTrelicaCoverageCell({
  cells,
  replacement,
}: {
  cells: readonly TrelicaCoverageCell[];
  replacement: TrelicaCoverageCell;
}): readonly TrelicaCoverageCell[] {
  return [...cells.filter((cell) => cell.surface !== replacement.surface), replacement];
}
