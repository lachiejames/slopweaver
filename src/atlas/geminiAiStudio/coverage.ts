/**
 * Building this atlas's coverage cells.
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

import { GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type {
  GeminiAiStudioArtifactRef,
  GeminiAiStudioChannel,
  GeminiAiStudioCoverageCell,
  GeminiAiStudioCoverageState,
  GeminiAiStudioEvidenceRole,
} from "./model.js";
import { geminiAiStudioVisibilityScopeFor } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function geminiAiStudioCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: GeminiAiStudioCoverageCell;
  nowMs: number;
}): FreshnessAssessment {
  return coverageFreshness({
    cell,
    nowMs,
    windowMs: atlasFreshnessWindowMs({ descriptor: GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR }),
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
export function succeededGeminiAiStudioCoverageCell({
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
  channel: GeminiAiStudioChannel;
  role: GeminiAiStudioEvidenceRole;
  scope: string;
  state: GeminiAiStudioCoverageState;
  reason: string;
  artifacts: readonly GeminiAiStudioArtifactRef[];
  at: string;
}): GeminiAiStudioCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: geminiAiStudioVisibilityScopeFor({ channel }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    visibilityScope: geminiAiStudioVisibilityScopeFor({ channel }),
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
 */
export function failedGeminiAiStudioCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: GeminiAiStudioCoverageCell | null;
  surface: string;
  channel: GeminiAiStudioChannel;
  role: GeminiAiStudioEvidenceRole;
  scope: string;
  state: GeminiAiStudioCoverageState;
  reason: string;
  unblockedBy: string | null;
}): GeminiAiStudioCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: geminiAiStudioVisibilityScopeFor({ channel }),
  });
  return {
    ...cell,
    artifacts: [...cell.artifacts],
    channel,
    visibilityScope: geminiAiStudioVisibilityScopeFor({ channel }),
  };
}
