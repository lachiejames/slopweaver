/**
 * One kind's attempt at its required surfaces, and how that attempt becomes a stored file.
 *
 * Split out of `sync.ts` because two callers now need it: `syncRunners.ts`, for the kinds that read two
 * surfaces or withhold a field, and `syncCensus.ts`, for the thirteen that read one surface and store every
 * attribute unchanged. `sync.ts` keeps the lock, the trusted read and the publish — the shell — while this
 * file holds the per-kind logic both shells run.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { failedVantaCoverageCell, succeededVantaCoverageCell } from "./coverage.js";
import { openVantaGap, reconcileVantaGaps, VANTA_GAP_CONDITIONS, type VantaGapCondition } from "./gaps.js";
import { vantaRequiredSurfacesForKind } from "./inventory.js";
import { mergeVantaKind } from "./merge.js";
import type { VantaCoverageCell, VantaEntity, VantaEvidenceRole, VantaGap, VantaKind, VantaKindFile } from "./model.js";
import type { VantaPendingSensitiveWrite } from "./privacy.js";
import { type VantaSurfaceError, vantaSurfaceCondition } from "./surfaceErrors.js";
import { type VantaSyncError, VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";

/** One surface's outcome: the items on success, or the coverage cell and gap a failure earns. */
export interface SurfaceAttempt<TItem> {
  readonly items: readonly TItem[] | null;
  readonly coverageCell: VantaCoverageCell;
  readonly gap: VantaGap | null;
  /** The condition a failed attempt's gap was opened with, typed; `null` exactly when `gap` is. */
  readonly condition: VantaGapCondition | null;
}

/**
 * The items one surface attempt read, to project. A failed attempt read none, by design: `items` is `null`
 * exactly on the failure arm, whose coverage cell and gap already carry the failure, and {@link foldKindSync}
 * merges no entity from a kind any of whose attempts failed — so projecting nothing loses nothing.
 *
 * @param attempt one surface's outcome
 * @returns the items read, or an empty list for a failed attempt
 */
export function attemptItems<TItem>({ attempt }: { attempt: SurfaceAttempt<TItem> }): readonly TItem[] {
  if (attempt.items === null) {
    return [];
  }
  return attempt.items;
}

/**
 * Run one surface call at a role {@link attemptSurface} has already resolved from the inventory, and turn the
 * result into a coverage cell plus, on failure, a gap. Not exported: a caller-supplied role would be a way to
 * grade a pair the inventory does not declare.
 */
async function attemptRoledSurface<TItem>({
  kind,
  surface,
  role,
  previousCoverage,
  fetch,
  at,
}: {
  kind: VantaKind;
  surface: string;
  role: VantaEvidenceRole;
  previousCoverage: VantaCoverageCell | null;
  fetch: () => Promise<Result<readonly TItem[], VantaSurfaceError>>;
  at: string;
}): Promise<SurfaceAttempt<TItem>> {
  const attempted = await fetch();
  if (attempted.isOk()) {
    return {
      condition: null,
      coverageCell: succeededVantaCoverageCell({
        artifacts: [],
        at,
        channel: "manage-api",
        reason: `${String(attempted.value.length)} record(s) read`,
        role,
        scope: surface,
        state: "synced",
        surface,
      }),
      gap: null,
      items: attempted.value,
    };
  }
  // The gap is graded from the failure's code, set where the failure was still typed — never from its lines.
  const condition = vantaSurfaceCondition({ error: attempted.error });
  const reason = attempted.error.reasons.join("; ");
  return {
    condition,
    coverageCell: failedVantaCoverageCell({
      channel: "manage-api",
      previous: previousCoverage,
      reason,
      role,
      scope: surface,
      state: condition === "api-credential-not-configured" ? "not-configured" : "unreadable",
      surface,
      unblockedBy:
        condition === "api-credential-not-configured" ? "export VANTA_CLIENT_ID and VANTA_CLIENT_SECRET" : null,
    }),
    gap: openVantaGap({ at, channel: "manage-api", condition, kind, reason, scope: surface }),
    items: null,
  };
}

/** The previous coverage cell for one surface, or `null` when this is the first attempt at it. * @returns the cell as it stood before this run, or `null` when this surface has never been attempted
 */
export function findCoverageCell({
  coverage,
  surface,
}: {
  coverage: readonly VantaCoverageCell[];
  surface: string;
}): VantaCoverageCell | null {
  const cell = coverage.find((candidate) => candidate.surface === surface && candidate.channel === "manage-api");
  if (cell === undefined) {
    // Absent by design: a surface this kind file has never attempted has no prior cell to carry forward.
    return null;
  }
  return cell;
}

/** Replace this run's cells into the existing coverage array, leaving every other surface's cell untouched. */
function replaceCoverageCells({
  existing,
  updated,
}: {
  existing: readonly VantaCoverageCell[];
  updated: readonly VantaCoverageCell[];
}): readonly VantaCoverageCell[] {
  const updatedSurfaces = new Set(updated.map((cell) => cell.surface));
  return [...existing.filter((cell) => !updatedSurfaces.has(cell.surface)), ...updated];
}

/** One kind's full attempt: every required surface run, projected, and merged if complete. */
export interface KindSyncResult {
  readonly kind: VantaKind;
  readonly complete: boolean;
  readonly file: VantaKindFile;
  readonly pendingWrites: readonly VantaPendingSensitiveWrite[];
  readonly reasons: readonly string[];
  /**
   * The gap condition each failed attempt opened, beside {@link reasons}' lines. A child kind fanning out
   * over this one inherits its grade from these when this kind did not read — never from the lines.
   */
  readonly failedConditions: readonly VantaGapCondition[];
  /**
   * The provider ids this run actually OBSERVED, which is not what `file.entities` holds.
   *
   * The merged file keeps an entity the provider no longer returns — marked stale rather than removed —
   * and it keeps entities the BROWSER channel contributed, which the Manage API never saw. Either would be
   * wrong to fan a child surface out over: a vendor deleted in Vanta would be asked for and 404, taking the
   * whole child kind down with it, and a browser-only row has no Manage API id to ask with at all. A Codex
   * review pass caught this reading `file.entities`, and it was right — the doc comment beside it already
   * claimed the ids came from this run.
   */
  readonly observedProviderIds: readonly string[];
}

/** Fold this kind's surface attempts into its stored file: coverage/gaps always update, entities only on a complete read. * @returns the kind's updated file and whether this run read it completely, or why the fold was refused
 */
export function foldKindSync({
  kind,
  stored,
  attempts,
  observedEntities,
  at,
}: {
  kind: VantaKind;
  stored: VantaKindFile;
  attempts: readonly SurfaceAttempt<unknown>[];
  observedEntities: readonly VantaEntity[];
  at: string;
}): Result<KindSyncResult> {
  const complete = attempts.every((attempt) => attempt.items !== null);
  const coverage = [
    ...replaceCoverageCells({ existing: stored.coverage, updated: attempts.map((attempt) => attempt.coverageCell) }),
  ];
  const observedGaps = attempts.flatMap((attempt) => (attempt.gap === null ? [] : [attempt.gap]));
  const rechecks = attempts
    .filter((attempt) => attempt.items !== null)
    .flatMap((attempt) =>
      VANTA_GAP_CONDITIONS.map((condition) => ({ condition, resolved: true, scope: attempt.coverageCell.surface })),
    );
  const gaps = reconcileVantaGaps({ at, observed: observedGaps, rechecks, runFailed: !complete, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }

  const observedProviderIds = observedEntities.map((entity) => entity.providerId);
  if (!complete) {
    return ok({
      complete: false,
      failedConditions: attempts.flatMap((attempt) => (attempt.condition === null ? [] : [attempt.condition])),
      file: { ...stored, coverage, gaps: [...gaps.value], updatedAt: at },
      kind,
      observedProviderIds,
      pendingWrites: [],
      reasons: attempts.flatMap((attempt) => (attempt.gap === null ? [] : [attempt.gap.reason])),
    });
  }

  const merged = mergeVantaKind({ at, observed: observedEntities, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  return ok({
    complete: true,
    failedConditions: [],
    file: { ...stored, coverage, entities: [...merged.value], gaps: [...gaps.value], updatedAt: at },
    kind,
    observedProviderIds,
    pendingWrites: [],
    reasons: [],
  });
}

/**
 * What one manage-api surface's evidence is worth, read from the row `inventory.ts` declares for it. A pair
 * no row declares has no grade to give, so it is a typed refusal rather than the strongest one: an unknown
 * surface silently counting as authoritative is the defect this replaced.
 *
 * @returns the declared role, or `SURFACE_UNDECLARED` when no manage-api row names this kind and surface
 */
export function roleFor({
  kind,
  surface,
}: {
  kind: VantaKind;
  surface: string;
}): Result<VantaEvidenceRole, VantaSyncError> {
  const entry = vantaRequiredSurfacesForKind({ kind }).find(
    (candidate) => candidate.surface === surface && candidate.channel === "manage-api",
  );
  if (entry === undefined) {
    return err(VantaSyncErrors.surfaceUndeclared({ kind, surface }));
  }
  return ok(entry.role);
}

/**
 * Run one surface call, grading it from the inventory's own row. An undeclared surface is refused BEFORE the
 * provider is asked anything.
 *
 * @returns the surface's attempt, or the one-line reason its kind and surface are not declared
 */
export async function attemptSurface<TItem>({
  kind,
  surface,
  previousCoverage,
  fetch,
  at,
}: {
  kind: VantaKind;
  surface: string;
  previousCoverage: VantaCoverageCell | null;
  fetch: () => Promise<Result<readonly TItem[], VantaSurfaceError>>;
  at: string;
}): Promise<Result<SurfaceAttempt<TItem>>> {
  const role = roleFor({ kind, surface });
  if (role.isErr()) {
    return err(vantaSyncErrorLines({ error: role.error }));
  }
  return ok(await attemptRoledSurface({ at, fetch, kind, previousCoverage, role: role.value, surface }));
}

/**
 * Run one kind's several surfaces in order, each graded from its inventory row, carrying each surface's
 * previous coverage forward. A surface the inventory does not declare ends the run there, unasked.
 *
 * @returns one attempt per surface, in the order given, or why the first undeclared surface was refused
 */
export async function attemptSurfaces<TItem>({
  kind,
  surfaces,
  coverage,
  at,
}: {
  kind: VantaKind;
  surfaces: readonly {
    readonly surface: string;
    readonly fetch: () => Promise<Result<readonly TItem[], VantaSurfaceError>>;
  }[];
  coverage: readonly VantaCoverageCell[];
  at: string;
}): Promise<Result<readonly SurfaceAttempt<TItem>[]>> {
  const attempts: SurfaceAttempt<TItem>[] = [];
  for (const { surface, fetch } of surfaces) {
    const attempt = await attemptSurface<TItem>({
      at,
      fetch,
      kind,
      previousCoverage: findCoverageCell({ coverage, surface }),
      surface,
    });
    if (attempt.isErr()) {
      return err(attempt.error);
    }
    attempts.push(attempt.value);
  }
  return ok(attempts);
}

/** Sync a single-surface kind, given its fetch/project functions. * @returns the kind's result, or why the fold was refused
 */
export async function syncSingleSurface<TDto>({
  kind,
  surface,
  stored,
  fetch,
  project,
  at,
}: {
  kind: VantaKind;
  surface: string;
  stored: VantaKindFile;
  fetch: () => Promise<Result<readonly TDto[], VantaSurfaceError>>;
  project: (input: { dto: TDto; at: string }) => {
    entity: VantaEntity;
    pendingWrite: VantaPendingSensitiveWrite | null;
  };
  at: string;
}): Promise<Result<KindSyncResult>> {
  const attempted = await attemptSurface<TDto>({
    at,
    fetch,
    kind,
    previousCoverage: findCoverageCell({ coverage: stored.coverage, surface }),
    surface,
  });
  if (attempted.isErr()) {
    return err(attempted.error);
  }
  const attempt = attempted.value;
  const projections = attemptItems({ attempt }).map((dto) => project({ at, dto }));
  const folded = foldKindSync({
    at,
    attempts: [attempt],
    kind,
    observedEntities: projections.map((projection) => projection.entity),
    stored,
  });
  if (folded.isErr()) {
    return folded;
  }
  const pendingWrites = folded.value.complete
    ? projections.flatMap((projection) => (projection.pendingWrite === null ? [] : [projection.pendingWrite]))
    : [];
  return ok({ ...folded.value, pendingWrites });
}
