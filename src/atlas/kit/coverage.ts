/**
 * Building and reading coverage cells — one cell per surface per scope.
 *
 * A cell's freshness is judged from its own `lastSuccessAt`/`latestAttemptFailed` rather than one
 * `observedAt`, because a single timestamp cannot answer "is this still current" after a run that failed
 * following one that succeeded. That is why {@link AtlasCoverageCell} carries two fields where a naive
 * shape carries one.
 *
 * Both pre-kit atlases had arrived at the same seven coverage states and the same success/failure
 * constructors; what differed was only that one tracked a surface per cell and the other, having declared a
 * single acquisition channel, did not. The kit keeps the surface — an atlas with one surface names it once,
 * which costs nothing, and an atlas that later grows a second does not need its stored shape changed.
 *
 * ## Judging freshness takes less than a whole cell, on purpose
 *
 * {@link coverageFreshness} reads two fields, so it asks for two ({@link FreshnessBearingCell}) rather than
 * for an {@link AtlasCoverageCell}. The Cloudflare atlas's stored cell predates this module and carries
 * neither `surface`, `role` nor `artifacts`; adding them to satisfy a parameter type would be an on-disk
 * layout change, which is a schema bump, which is a forced reset on every install that already has data.
 * Same reasoning as `gaps.ts`'s `ReconcilableGap` and `merge.ts`'s fold callback: what generalises is the
 * judgement, never the stored shape.
 */
import type { AtlasArtifactRef, AtlasCoverageState, AtlasEvidenceRole } from "./contract.js";
import { assessFreshness, type FreshnessAssessment } from "./freshness.js";

/** What is known about one surface at one scope, and what it is worth. */
export interface AtlasCoverageCell {
  readonly artifacts: readonly AtlasArtifactRef[];
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
  readonly reason: string;
  readonly role: AtlasEvidenceRole;
  readonly scope: string;
  readonly state: AtlasCoverageState;
  readonly surface: string;
  /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
  readonly unblockedBy: string | null;
  /** The permanent claim boundary this cell was measured under — the platform's own words. */
  readonly visibilityScope: string;
}

/** The two fields a freshness judgement actually rests on. See this file's header on why it is not a cell. */
export interface FreshnessBearingCell {
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
}

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge — any stored shape carrying the last success and the latest attempt's fate
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @param windowMs the platform's declared freshness window; omitted takes the kit's four-hour default
 * @returns the freshness verdict and the notes to print
 */
export function coverageFreshness({
  cell,
  nowMs,
  windowMs,
}: {
  cell: FreshnessBearingCell;
  nowMs: number;
  windowMs?: number;
}): FreshnessAssessment {
  return assessFreshness({
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    nowMs,
    ...(windowMs === undefined ? {} : { windowMs }),
  });
}

/**
 * Build a coverage cell for an acquisition attempt that succeeded.
 *
 * @param surface which surface produced this look
 * @param role what this surface's evidence is worth here
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned
 * @param reason why, in English
 * @param artifacts the evidence backing this look — screenshots included
 * @param visibilityScope the platform's permanent claim boundary
 * @param at this run's ISO timestamp
 * @param unblockedBy what would widen a look that SUCCEEDED and is still bounded; omitted means nothing is
 * outstanding, which is what a `synced` cell says
 * @returns the cell, stamped as a fresh success
 */
export function succeededCoverageCell({
  surface,
  role,
  scope,
  state,
  reason,
  artifacts,
  visibilityScope,
  at,
  unblockedBy = null,
}: {
  surface: string;
  role: AtlasEvidenceRole;
  scope: string;
  state: AtlasCoverageState;
  reason: string;
  artifacts: readonly AtlasArtifactRef[];
  visibilityScope: string;
  at: string;
  unblockedBy?: string | null;
}): AtlasCoverageCell {
  return {
    // Spread so a stored cell never aliases the caller's own array.
    artifacts: [...artifacts],
    lastSuccessAt: at,
    latestAttemptFailed: false,
    reason,
    role,
    scope,
    state,
    surface,
    // Defaults to `null`, so every caller that predates this parameter is unchanged. It exists because a
    // look can SUCCEED and still be bounded — a pass that issued a paging operation's first page did not
    // fail, so `failedCoverageCell` would misreport it, and yet there is plainly something outstanding to
    // name. A `state` other than `synced` on a success is exactly that case.
    unblockedBy,
    visibilityScope,
  };
}

/**
 * Build a coverage cell for an acquisition attempt that failed.
 *
 * The prior success is carried forward rather than erased — a failed attempt must not make an earlier
 * successful look disappear, only stop being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface was never touched
 * @param surface which surface attempted this look
 * @param role what this surface's evidence is worth here
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @param visibilityScope the platform's permanent claim boundary
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedCoverageCell({
  previous,
  surface,
  role,
  scope,
  state,
  reason,
  unblockedBy,
  visibilityScope,
}: {
  previous: AtlasCoverageCell | null;
  surface: string;
  role: AtlasEvidenceRole;
  scope: string;
  state: AtlasCoverageState;
  reason: string;
  unblockedBy: string | null;
  visibilityScope: string;
}): AtlasCoverageCell {
  return {
    // A surface with no prior cell has never been attempted, so there is no evidence or success to carry.
    artifacts: previous === null ? [] : previous.artifacts,
    lastSuccessAt: previous === null ? null : previous.lastSuccessAt,
    latestAttemptFailed: true,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope,
  };
}
