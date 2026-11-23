/**
 * Building this atlas's coverage cells, and the one judgement that is genuinely CrowdStrike's own.
 *
 * The cell shape, the success/failure constructors and the freshness rule are the kit's. What lives here is
 * {@link crowdstrikeCoverageStateFor}: the mapping from a typed provider failure to a coverage state.
 *
 * That mapping is the whole basis of an honest coverage table on this platform, and it is measured rather
 * than assumed. Measured live, three outcomes that look alike from the outside are
 * cleanly distinguishable — an unscoped call answers HTTP 403 with exactly `access denied, scope not
 * permitted`, an authorised but empty query answers 200 with an empty list, and an absent or unprovisioned
 * product answers 404. Reproduce with `slopweaver crowdstrike sync --dry-run`.
 *
 * So a scope refusal is `unreadable` — "it is set up and this credential may not see it" — and never
 * `not-configured`, which would say nobody set it up, and never `excluded`, which would imply a decision
 * somebody made. Only a genuinely missing credential is `not-configured`, which is the precedent both
 * sibling atlases already write (`onepassword/syncCore.ts`, `vanta/sync.ts`).
 */
import type { AtlasCoverageState, AtlasEvidenceRole } from "../kit/contract.js";
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import { CROWDSTRIKE_VISIBILITY_SCOPE } from "./descriptor.js";
import type { CrowdstrikeCoverageCell } from "./entities.js";
import type { CrowdstrikeError } from "./errors.js";
import type { CrowdstrikeKind, CrowdstrikeSurface } from "./model.js";

/**
 * The coverage scope string one kind is recorded under.
 *
 * One cell per kind per surface, so a kind the API cannot read and the browser can shows both facts rather
 * than one overwriting the other.
 *
 * @param kind the kind this scope is for
 * @returns the scope string
 */
export function crowdstrikeKindScope({ kind }: { kind: CrowdstrikeKind }): string {
  return `tenant/${kind}`;
}

/**
 * The coverage state a typed provider failure earns.
 *
 * Exhaustive over the error union with a `never` default, so a new failure kind fails to compile here
 * rather than falling through to a plausible-looking state at runtime.
 *
 * @param error the failure to grade
 * @returns the coverage state to publish for it
 */
export function crowdstrikeCoverageStateFor({ error }: { error: CrowdstrikeError }): AtlasCoverageState {
  switch (error.code) {
    case "SCOPE_REFUSED":
      return "unreadable";
    case "ROUTE_ABSENT":
      return "unavailable";
    case "AUTH_FAILED":
      return "invalid-configuration";
    case "INCOMPLETE_READ":
    case "TRANSPORT_EXHAUSTED":
      return "deferred";
    case "UNUSABLE_RESPONSE":
      return "unreadable";
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

/**
 * What would unblock a failure, when that is knowable from the failure itself.
 *
 * A scope refusal is the only case with a real answer, and it is worth stating exactly because the reader
 * of a coverage table is usually the person who can grant the scope.
 *
 * @param error the failure to advise on
 * @returns the unblocking action, or `null` when the failure names no action
 */
export function crowdstrikeUnblockedBy({ error }: { error: CrowdstrikeError }): string | null {
  if (error.code === "SCOPE_REFUSED") {
    return error.scope === null
      ? "grant this API client the Falcon read scope this endpoint sits behind"
      : `grant this API client Read on ${error.scope} in the Falcon console's API clients page`;
  }
  if (error.code === "AUTH_FAILED") {
    return "check crowdstrike-api-host, crowdstrike-client-id and crowdstrike-client-secret in the secrets store";
  }
  return null;
}

/**
 * Build a coverage cell for a read that succeeded.
 *
 * @param surface which surface produced this look
 * @param role what this surface's evidence is worth here
 * @param scope the concrete scope acquired
 * @param reason why, in English — what was read and how much of it
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function succeededCrowdstrikeCoverageCell({
  surface,
  role,
  scope,
  reason,
  at,
}: {
  surface: CrowdstrikeSurface;
  role: AtlasEvidenceRole;
  scope: string;
  reason: string;
  at: string;
}): CrowdstrikeCoverageCell {
  const cell = succeededCoverageCell({
    artifacts: [],
    at,
    reason,
    role,
    scope,
    state: "synced",
    surface,
    visibilityScope: CROWDSTRIKE_VISIBILITY_SCOPE,
  });
  return { ...cell, artifacts: [...cell.artifacts], surface };
}

/**
 * Build a coverage cell for a read that failed, grading the failure by its own typed kind.
 *
 * The prior success is carried forward rather than erased — a failed attempt must not make an earlier
 * successful look disappear, only stop being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this scope was never touched
 * @param surface which surface attempted this look
 * @param role what this surface's evidence is worth here
 * @param scope the concrete scope attempted
 * @param error the typed failure, which decides both the state and the unblocking advice
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedCrowdstrikeCoverageCell({
  previous,
  surface,
  role,
  scope,
  error,
}: {
  previous: CrowdstrikeCoverageCell | null;
  surface: CrowdstrikeSurface;
  role: AtlasEvidenceRole;
  scope: string;
  error: CrowdstrikeError;
}): CrowdstrikeCoverageCell {
  const cell = failedCoverageCell({
    previous,
    reason: error.message,
    role,
    scope,
    state: crowdstrikeCoverageStateFor({ error }),
    surface,
    unblockedBy: crowdstrikeUnblockedBy({ error }),
    visibilityScope: CROWDSTRIKE_VISIBILITY_SCOPE,
  });
  return { ...cell, artifacts: [...cell.artifacts], surface };
}

/**
 * Replace one scope's cell on a surface, leaving every other cell exactly as it was.
 *
 * Keyed on the PAIR, not on the scope alone: one kind carries a cell per surface, and a run over the API
 * that overwrote the browser's cell would erase the second surface's evidence — the exact corroboration
 * loss the two-surface design exists to prevent.
 *
 * @param cells the kind file's stored cells
 * @param cell the cell this run produced
 * @returns the cells with that one surface-and-scope replaced, in stable order
 */
export function replaceCrowdstrikeCoverageCell({
  cells,
  cell,
}: {
  cells: readonly CrowdstrikeCoverageCell[];
  cell: CrowdstrikeCoverageCell;
}): readonly CrowdstrikeCoverageCell[] {
  const kept = cells.filter((existing) => existing.scope !== cell.scope || existing.surface !== cell.surface);
  return [...kept, cell].toSorted(
    (left, right) => left.surface.localeCompare(right.surface) || left.scope.localeCompare(right.scope),
  );
}
