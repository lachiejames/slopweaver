/**
 * Building this atlas's coverage cells, and the two judgements that are genuinely GitHub's own.
 *
 * The cell shape, the success/failure constructors and the freshness rule are the kit's. What lives here is
 * the mapping from a typed provider failure to a coverage state, and the SUCCESS predicate a sync exits on.
 *
 * ## Why the success predicate is here rather than taken from the kit
 *
 * `kit/coverage.ts`'s `hasUsableCoverage` is `cells.some(...)` and its own JSDoc calls it "the exit-0
 * condition for a sync". That is EXISTENTIAL where the owner's bar is universal: under it, every
 * configuration kind but one could fail, that one succeed, and the sync would report success, publish, and
 * leave the routing layer offering the atlas as a current-truth source. {@link githubApiSyncSucceeded}
 * requires every MANDATORY kind instead, with declared `not-configured` and `excluded` cells allowed
 * through — an atlas legitimately has optional surfaces, so a blanket universal would be wrong too.
 *
 * ## A 403 is a boundary, not a failure, and the state says which
 *
 * GitHub answers 403 for an unpermissioned fine-grained token, an unaccepted SSO authorisation, a non-owner
 * role and a plan that lacks the feature. All are `unreadable` — "it is set up and this credential may not
 * see it" — and never `not-configured`, which would say nobody set it up, and never `excluded`, which would
 * imply somebody decided. Only a missing credential is `not-configured`. A plan gap is `unavailable`,
 * because unlike a scope refusal there is no grant that opens it.
 */
import type { AtlasCoverageState, AtlasEvidenceRole } from "../kit/contract.js";
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";

import { GITHUB_VISIBILITY_SCOPE } from "./descriptor.js";
import type { GithubAtlasError } from "./errors.js";
import type { GithubCoverageCell } from "./kindFiles.js";
import { GITHUB_KINDS, type GithubKind, type GithubSurface, isMandatoryApiKind } from "./model.js";

/**
 * The coverage scope string one read is recorded under.
 *
 * One cell per SURFACE per SCOPE per CALL, and the last of those three was a defect for a while. Cells are
 * replaced by `(scope, surface)`, and two calls can feed one kind at one scopeRef — GitHub splits its
 * Actions policy across an enablement route and a workflow-defaults route. Without the call in the key, the
 * second call's success REPLACED the first call's refusal, and a sync that never read half of an Actions
 * policy reported the kind fully covered. `callId` is what keeps them apart.
 *
 * It is optional because the browser surface has no call table: its cells are per kind, and passing no
 * `callId` keeps the shorter key those use.
 *
 * @param kind the kind this scope is for
 * @param scopeRef the organisation or `owner/repo` it was read at
 * @param callId the admitted call that produced it, where one exists
 * @returns the scope string
 */
export function githubKindScope({
  kind,
  scopeRef,
  callId,
}: {
  kind: GithubKind;
  scopeRef: string;
  callId?: string;
}): string {
  return callId === undefined ? `${scopeRef}/${kind}` : `${scopeRef}/${kind}/${callId}`;
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
export function githubCoverageStateFor({ error }: { error: GithubAtlasError }): AtlasCoverageState {
  switch (error.code) {
    case "SCOPE_REFUSED":
      return "unreadable";
    case "ROUTE_ABSENT":
    case "PLAN_UNAVAILABLE":
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
 * The reader of a coverage table is usually the person who can grant the permission, so a scope refusal
 * earns a real sentence. A plan gap earns one too, and it is the opposite advice: no grant will help.
 *
 * @param error the failure to advise on
 * @returns the unblocking action, or `null` when the failure names no action
 */
export function githubUnblockedBy({ error }: { error: GithubAtlasError }): string | null {
  if (error.code === "SCOPE_REFUSED") {
    return error.scope === null
      ? "check that this token's SSO authorisation is accepted for the organisation and that the account holds an owner role — GitHub named no permission, which is what both of those look like"
      : `grant this token the ${error.scope} permission`;
  }
  if (error.code === "AUTH_FAILED") {
    return "check the github-token entry in the secrets store, or the gh CLI's own session";
  }
  if (error.code === "PLAN_UNAVAILABLE") {
    return null;
  }
  return null;
}

/**
 * Build a coverage cell for a read that succeeded.
 *
 * @param surface which surface produced this look
 * @param role what this surface's evidence is worth here
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned — `synced` for a complete read, `deferred` for a
 *   partial one, so a walk that reached forty of six hundred pages cannot report as fully covered
 * @param reason why, in English — what was read and how much of it
 * @param artifacts the evidence backing this look, screenshots included
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 */
export function succeededGithubCoverageCell({
  surface,
  role,
  scope,
  state,
  reason,
  artifacts,
  at,
}: {
  surface: GithubSurface;
  role: AtlasEvidenceRole;
  scope: string;
  state: AtlasCoverageState;
  reason: string;
  artifacts: GithubCoverageCell["artifacts"];
  at: string;
}): GithubCoverageCell {
  const cell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: GITHUB_VISIBILITY_SCOPE,
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
export function failedGithubCoverageCell({
  previous,
  surface,
  role,
  scope,
  error,
}: {
  previous: GithubCoverageCell | null;
  surface: GithubSurface;
  role: AtlasEvidenceRole;
  scope: string;
  error: GithubAtlasError;
}): GithubCoverageCell {
  const cell = failedCoverageCell({
    previous,
    reason: error.message,
    role,
    scope,
    state: githubCoverageStateFor({ error }),
    surface,
    unblockedBy: githubUnblockedBy({ error }),
    visibilityScope: GITHUB_VISIBILITY_SCOPE,
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
export function replaceGithubCoverageCell({
  cells,
  cell,
}: {
  cells: readonly GithubCoverageCell[];
  cell: GithubCoverageCell;
}): readonly GithubCoverageCell[] {
  const kept = cells.filter((existing) => existing.scope !== cell.scope || existing.surface !== cell.surface);
  return [...kept, cell].toSorted(
    (left, right) => left.surface.localeCompare(right.surface) || left.scope.localeCompare(right.scope),
  );
}

/**
 * Whether one coverage cell is an honest end.
 *
 * Either the atlas read it, or the platform itself cannot offer it here: `not-configured` (no credential),
 * `unavailable` (no such route, or not on this plan) and `excluded` (a stated decision) are all honest.
 * `unreadable`, `deferred` and `invalid-configuration` are not — each means the atlas wanted something and
 * did not get it.
 *
 * `held-elsewhere` is deliberately NOT honest here, and the kit says why: it means a named store owns the
 * data, so this atlas is not its source of record and a sync must not exit zero on the strength of one.
 *
 * @param cell the cell to judge
 * @returns whether it may count towards a kind being covered
 */
function isCoveredCell({ cell }: { cell: GithubCoverageCell }): boolean {
  if (cell.role === "authoritative" && cell.state === "synced") {
    return true;
  }
  return cell.state === "not-configured" || cell.state === "unavailable" || cell.state === "excluded";
}

/**
 * Whether an API sync may report success — UNIVERSAL, both ACROSS kinds and WITHIN one.
 *
 * The within-a-kind half is the one a review caught. An earlier version asked whether a kind had ANY synced
 * cell, and a kind carries one cell per SCOPE: so an organisation whose settings read succeeded masked a
 * second organisation whose read was refused, and the sync exited zero having never read half of what it
 * claimed to cover. That is the same existential defect as `kit/coverage.ts`'s `hasUsableCoverage`, one
 * level down, and fixing it at the kind level alone would have left it standing where it actually bites.
 *
 * @param cells every coverage cell this run produced or preserved, across all kinds
 * @returns the mandatory kinds that are not covered; empty means the sync may report success
 */
export function githubUncoveredMandatoryKinds({
  cells,
}: {
  cells: Readonly<Partial<Record<GithubKind, readonly GithubCoverageCell[]>>>;
}): readonly GithubKind[] {
  const uncovered: GithubKind[] = [];
  for (const kind of GITHUB_KINDS) {
    const kindCells = cells[kind];
    if (!isMandatoryApiKind({ kind }) || kindCells === undefined) {
      continue;
    }
    if (kindCells.length === 0 || !kindCells.every((cell) => isCoveredCell({ cell }))) {
      uncovered.push(kind);
    }
  }
  return uncovered.toSorted();
}
