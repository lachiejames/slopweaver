/**
 * The PURE half of a sync run: turning one surface attempt into coverage and gaps, folding a kind's
 * attempts into its stored file, and projecting rows without stopping at the first refusal.
 *
 * Split from `sync.ts` so every branch here is reachable without a subprocess, a network call or a clock.
 * The effectful half owns the `op` invocations, the Events API walk, the lock and the publish.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { failedOnepasswordCoverageCell, findCoverageCell, succeededOnepasswordCoverageCell } from "./coverage.js";
import {
  ONEPASSWORD_GAP_CONDITIONS,
  type OnepasswordGapCondition,
  onepasswordUnblockFor,
  openOnepasswordGap,
  reconcileOnepasswordGaps,
} from "./gaps.js";
import { ONEPASSWORD_REQUIRED_SURFACES, type OnepasswordRequiredSurfaceName } from "./inventory.js";
import { mergeOnepasswordKind } from "./merge.js";
import type {
  OnepasswordChannel,
  OnepasswordCoverageCell,
  OnepasswordEntity,
  OnepasswordEvidenceRole,
  OnepasswordGap,
  OnepasswordKind,
  OnepasswordKindFile,
} from "./model.js";

/**
 * Where a sync reports what it is DOING, as it does it, rather than only what it did.
 *
 * A sync that prints only its final report is indistinguishable from a hang while it walks one `op` call
 * per vault, so the owner watching a real roster run needs live output. Injected rather than reached for, so this half stays pure and a test
 * can capture the lines.
 */
export type OnepasswordProgress = (input: { line: string }) => void;

/**
 * One finished kind, as a line for {@link OnepasswordProgress}.
 *
 * @param result the kind's outcome
 * @returns the line to publish
 */
export function progressLineFor({ result }: { result: OnepasswordSyncKindOutcome }): string {
  return result.complete
    ? `${result.kind}: synced, ${String(result.entityCount)} record(s)`
    : `${result.kind}: INCOMPLETE, ${String(result.entityCount)} record(s)`;
}

/** How this run's attempt at one kind resolved. */
export interface OnepasswordSyncKindOutcome {
  readonly kind: OnepasswordKind;
  readonly complete: boolean;
  readonly entityCount: number;
  readonly reasons: readonly string[];
}

/** Runs one allowed `op` surface. The real edge is `opCli.ts`; a fake is injected in tests. */
export type OpSurfaceRunner = (input: {
  surface: string;
  id?: string | null;
}) => Result<{ readonly rows: readonly unknown[]; readonly endpoint: string }>;

/** One surface's outcome: the rows on success, or the coverage cell and gap a failure earns. */
export interface OnepasswordSurfaceAttempt {
  readonly rows: readonly unknown[] | null;
  readonly coverageCell: OnepasswordCoverageCell;
  readonly gap: OnepasswordGap | null;
}

/**
 * What folding one kind's attempts produced.
 *
 * @internal
 */
export interface OnepasswordKindFold {
  readonly complete: boolean;
  readonly file: OnepasswordKindFile;
  readonly reasons: readonly string[];
}

/**
 * The role this atlas assigns one surface, read from the closed inventory rather than passed in.
 *
 * @param surface the surface name, closed over the required-surface table's own names
 * @returns the declared role
 *
 * @internal
 */
export function onepasswordSurfaceRole({
  surface,
}: {
  surface: OnepasswordRequiredSurfaceName;
}): OnepasswordEvidenceRole {
  // Total: `OnepasswordRequiredSurfaceName` is derived from this very table's `surface` fields, so every value
  // the type admits names a row, and a surface the table does not declare fails to compile at the caller.
  return ONEPASSWORD_REQUIRED_SURFACES.find((entry) => entry.surface === surface)!.role;
}

/**
 * The coverage state a failure condition earns.
 *
 * A missing credential is `not-configured`, which is an honest state rather than a fault; anything else is
 * `unreadable`. Separated out because the distinction drives the exit code, and a run that reported a
 * never-configured credential as a read failure would send the owner looking for a bug.
 *
 * @param condition the gap condition a failure earned
 * @returns the coverage state to record
 *
 * @internal
 */
export function onepasswordStateFor({
  condition,
}: {
  condition: OnepasswordGapCondition;
}): "not-configured" | "unreadable" {
  const notConfigured: readonly OnepasswordGapCondition[] = [
    "cli-not-installed",
    "cli-not-signed-in",
    "events-token-not-configured",
  ];
  return notConfigured.includes(condition) ? "not-configured" : "unreadable";
}

/**
 * Turn one succeeded surface call into an attempt.
 *
 * @param surface the surface name, which alone fixes the kind it feeds and the role its evidence carries
 * @param channel which channel produced this look
 * @param scope the concrete scope acquired, which for a per-parent call names the parent
 * @param rows what the call returned
 * @param at this run's ISO timestamp
 * @returns the attempt
 */
export function succeededAttempt({
  surface,
  channel,
  scope,
  rows,
  at,
}: {
  surface: OnepasswordRequiredSurfaceName;
  channel: OnepasswordChannel;
  scope: string;
  rows: readonly unknown[];
  at: string;
}): OnepasswordSurfaceAttempt {
  return {
    coverageCell: succeededOnepasswordCoverageCell({
      artifacts: [],
      at,
      channel,
      reason: `${String(rows.length)} record(s) read`,
      role: onepasswordSurfaceRole({ surface }),
      scope,
      state: "synced",
      surface,
    }),
    gap: null,
    rows,
  };
}

/**
 * Turn one failed surface call into an attempt, carrying the prior success forward rather than erasing it.
 *
 * @param kind the kind this surface feeds
 * @param surface the surface name
 * @param channel which channel attempted this look
 * @param scope the concrete scope attempted
 * @param condition the classified failure
 * @param reason why, in English
 * @param stored the kind file as it stood before this run, for the prior coverage cell
 * @param at this run's ISO timestamp
 * @returns the attempt
 */
export function failedAttempt({
  kind,
  surface,
  channel,
  scope,
  condition,
  reason,
  stored,
  at,
}: {
  kind: OnepasswordKind;
  surface: OnepasswordRequiredSurfaceName;
  channel: OnepasswordChannel;
  scope: string;
  condition: OnepasswordGapCondition;
  reason: string;
  stored: OnepasswordKindFile;
  at: string;
}): OnepasswordSurfaceAttempt {
  return {
    coverageCell: failedOnepasswordCoverageCell({
      channel,
      previous: findCoverageCell({ channel, coverage: stored.coverage, surface }),
      reason,
      role: onepasswordSurfaceRole({ surface }),
      scope,
      state: onepasswordStateFor({ condition }),
      surface,
      unblockedBy: onepasswordUnblockFor({ condition }),
    }),
    gap: openOnepasswordGap({ at, channel, condition, kind, reason, scope }),
    rows: null,
  };
}

/** Replace this run's cells into the existing coverage, leaving every other surface's cell untouched. */
function replaceCoverageCells({
  existing,
  updated,
}: {
  existing: readonly OnepasswordCoverageCell[];
  updated: readonly OnepasswordCoverageCell[];
}): readonly OnepasswordCoverageCell[] {
  const touched = new Set(updated.map((cell) => `${cell.surface} ${cell.channel}`));
  return [...existing.filter((cell) => !touched.has(`${cell.surface} ${cell.channel}`)), ...updated];
}

/**
 * A projection refusal is a gap on the kind, not a silent drop.
 *
 * @param reasons every refusal the projection reported for this scope
 * @returns one gap per refusal, or an empty list when the projection took every row
 */
export function projectionGaps({
  reasons,
  kind,
  scope,
  at,
}: {
  reasons: readonly string[];
  kind: OnepasswordKind;
  scope: string;
  at: string;
}): readonly OnepasswordGap[] {
  if (reasons.length === 0) {
    return [];
  }
  return [
    openOnepasswordGap({
      at,
      channel: "admin-cli",
      condition: "schema-drift",
      kind,
      reason: reasons.slice(0, 4).join("; "),
      scope: `${scope}:projection`,
    }),
  ];
}

/**
 * One completed fold, turned into the result the orchestration collects. Every kind ends the same shape, so
 * spelling it out per kind was six near-identical literals that could each drift on their own.
 *
 * @param fold the kind's folded generation
 * @returns the outcome plus the file it produced
 */
export function kindResult({
  fold,
  kind,
}: {
  fold: OnepasswordKindFold;
  kind: OnepasswordKind;
}): OnepasswordSyncKindOutcome & { file: OnepasswordKindFile } {
  return {
    complete: fold.complete,
    entityCount: fold.file.entities.length,
    file: fold.file,
    kind,
    reasons: fold.reasons,
  };
}

/**
 * Fold the vault listing and the per-vault detail pass into one observed set, plus the gaps the two passes
 * between them opened.
 *
 * The detail pass supersedes the listing for any vault it reached, because only it carries the item COUNT.
 * A vault the detail call could not reach keeps its listing record rather than vanishing - a vault the
 * atlas cannot count is still a vault someone can reach, and dropping it would understate access.
 *
 * @param listed every vault the listing pass projected
 * @param detail every vault the per-vault pass projected, which is a subset of `listed` on a partial run
 * @param reasons the projection refusals from both passes, folded into one gap set
 * @returns the superseded entity set and the gaps to carry onto the kind
 */
export function mergeVaultPasses({
  at,
  detail,
  listed,
  reasons,
}: {
  at: string;
  detail: readonly OnepasswordEntity[];
  listed: readonly OnepasswordEntity[];
  reasons: readonly string[];
}): { observed: readonly OnepasswordEntity[]; extraGaps: readonly OnepasswordGap[] } {
  const detailedIds = new Set(detail.map((entity) => entity.providerId));
  const observed = [...detail, ...listed.filter((entity) => !detailedIds.has(entity.providerId))];
  const countless = observed.filter(
    (entity) => entity.channels["admin-cli"]?.detail !== undefined && !detailedIds.has(entity.providerId),
  );
  return {
    extraGaps: [
      ...projectionGaps({ at, kind: "vault", reasons, scope: "vaults-list" }),
      ...(countless.length === 0
        ? []
        : [
            openOnepasswordGap({
              at,
              channel: "admin-cli",
              condition: "item-count-unavailable",
              kind: "vault",
              reason: `${String(countless.length)} vault(s) are listed but their own record could not be read, so this atlas holds no item count for them`,
              scope: "vault-detail",
            }),
          ]),
    ],
    observed,
  };
}

/**
 * Fold one kind's attempts into its stored file. Coverage and gaps always update; entities are merged only
 * on a COMPLETE read, because an entity missing from a half-finished read has not disappeared, it has not
 * been looked for. For this atlas's edge kinds that distinction is the difference between "nobody can reach
 * this vault" and "we did not manage to ask".
 *
 * @param channel which channel this run observed through
 * @param stored the kind file as it stood before this run
 * @param attempts every surface attempt this kind made
 * @param observed the entities successfully projected this run
 * @param extraGaps gaps this kind raises independently of any one surface attempt
 * @param at this run's ISO timestamp
 * @returns the folded file and whether the read was complete, or the reason it cannot be merged
 */
export function foldOnepasswordKind({
  channel,
  stored,
  attempts,
  observed,
  extraGaps,
  at,
}: {
  channel: OnepasswordChannel;
  stored: OnepasswordKindFile;
  attempts: readonly OnepasswordSurfaceAttempt[];
  observed: readonly OnepasswordEntity[];
  extraGaps: readonly OnepasswordGap[];
  at: string;
}): Result<OnepasswordKindFold> {
  const complete = attempts.length > 0 && attempts.every((attempt) => attempt.rows !== null);
  const coverage = [
    ...replaceCoverageCells({ existing: stored.coverage, updated: attempts.map((attempt) => attempt.coverageCell) }),
  ];
  const observedGaps = [...attempts.flatMap((attempt) => (attempt.gap === null ? [] : [attempt.gap])), ...extraGaps];
  const rechecks = attempts
    .filter((attempt) => attempt.rows !== null)
    .flatMap((attempt) =>
      ONEPASSWORD_GAP_CONDITIONS.map((condition) => ({
        condition,
        resolved: true,
        scope: attempt.coverageCell.scope,
      })),
    );
  const gaps = reconcileOnepasswordGaps({
    at,
    observed: observedGaps,
    rechecks,
    runFailed: !complete,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  if (!complete) {
    return ok({
      complete: false,
      file: { ...stored, coverage, gaps: [...gaps.value], updatedAt: at },
      reasons: observedGaps.map((gap) => gap.reason),
    });
  }
  const merged = mergeOnepasswordKind({ at, channel, observed, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  return ok({
    complete: true,
    file: { ...stored, coverage, entities: [...merged.value], gaps: [...gaps.value], updatedAt: at },
    reasons: [],
  });
}

/**
 * Project a run's rows, collecting every refusal rather than stopping at the first.
 *
 * One unparseable record must not lose the other four hundred, and it must not be silent either: the
 * reasons ride back so the kind's outcome can carry them.
 *
 * @param rows the raw provider records, or `null` when the surface call failed — nothing was read, so nothing
 *   projects, and the failure is already the attempt's own coverage cell and gap
 * @param project the per-kind projection to apply
 * @returns the entities that projected, and every reason a record did not
 */
export function projectOnepasswordRows({
  rows,
  project,
}: {
  rows: readonly unknown[] | null;
  project: (input: { raw: unknown }) => Result<OnepasswordEntity>;
}): { readonly entities: readonly OnepasswordEntity[]; readonly reasons: readonly string[] } {
  if (rows === null) {
    return { entities: [], reasons: [] };
  }
  const entities: OnepasswordEntity[] = [];
  const reasons: string[] = [];
  for (const raw of rows) {
    const projected = project({ raw });
    if (projected.isErr()) {
      reasons.push(...projected.error);
      continue;
    }
    entities.push(projected.value);
  }
  return { entities, reasons };
}
