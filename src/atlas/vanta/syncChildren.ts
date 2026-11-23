/**
 * Sync the families this atlas reaches by fanning out over a parent it already holds.
 *
 * `syncCensus.ts`'s runner makes one request per family. This one makes one request per PARENT ROW, so it
 * needs two things that runner does not: the parent kind's freshly-read entities, and an entity id that
 * carries both ends of the pairing.
 *
 * ## The parent ids come from THIS run, never from the file on disk
 *
 * `sync.ts` walks kinds in `API_SYNCED_KINDS` order and every child family's parent is earlier in that
 * order, so the parents this fans out over are the ones just read rather than the ones last published. That
 * matters on the run after a vendor is added: reading the stored file would fan out over yesterday's
 * vendors and publish a child set that silently omits the new one, while reporting the kind complete.
 *
 * ## A DECLARED per-parent ceiling is the one partial this runner accepts, and never for every parent
 *
 * `childCensus.ts` lets one surface name an HTTP status that means "this PARENT cannot serve me" — measured
 * once, on the one integration type Vanta refuses resource kinds for. A parent that hits it is skipped, is
 * recorded as a gap carrying the provider's own words, and is counted in the coverage cell's fraction, so
 * the kind still completes over the parents that answered. That is a deliberate exception to the paragraph
 * below rather than a hole in it: refusing the whole kind for one bounded parent cost every other parent's answer, and the
 * store's own never-acquired guard refused the generation outright rather than publish nothing.
 *
 * It has one floor. If EVERY parent is refused, there is no partial answer to publish — the surface has
 * gone away — so the walk fails and the kind's stored entities are left exactly as they were.
 *
 * ## A parent kind that did not read completely is a REFUSAL, not an empty fan-out
 *
 * If the parent's own read failed, this kind cannot be complete either — a fan-out over half the vendors
 * would publish half the assessments and look exactly like a tenant with half as many. So the child kind
 * takes the parent's failure as its own, names the parent surface in the reason, and leaves its previous
 * entities untouched through `foldKindSync`'s existing incomplete path.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { VANTA_CHILD_FAMILIES } from "./childCensus.js";
import { projectVantaChildRow } from "./childProjection.js";
import { type ChildRow, undeclaredShapeGaps } from "./childShapeGaps.js";
import type { VantaChildFamily, VantaChildKind, VantaChildSurface } from "./childSurface.js";
import type { VantaAtlasSyncClient } from "./client.js";
import { openVantaGap, reconcileVantaGaps, type VantaGapCondition, type VantaGapRecheck } from "./gaps.js";
import type { VantaEntity, VantaGap, VantaKind, VantaKindFile } from "./model.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "./surfaceErrors.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";
import {
  attemptItems,
  attemptSurface,
  findCoverageCell,
  foldKindSync,
  type KindSyncResult,
  roleFor,
  type SurfaceAttempt,
} from "./syncKind.js";

/**
 * How one parent kind's own read went this run — the ids a fan-out iterates, or why there are none.
 *
 * The failed arm carries the parent's OWN reasons rather than a sentence about the parent, because a reader
 * looking at `vendor-assessment`'s row wants to know that no token could be minted, not that `vendor` did
 * not read. A subprocess test asserts exactly that for every kind: the root cause reaches every row it
 * caused. Anything else buries the one fact that explains the whole run.
 */
export type VantaParentRead =
  | { readonly outcome: "read"; readonly ids: readonly string[] }
  | {
      readonly outcome: "failed";
      readonly reasons: readonly string[];
      /** The gap condition each of the parent's failed attempts opened — what the fan-out's own grade inherits. */
      readonly conditions: readonly VantaGapCondition[];
    };

/** Every parent kind's read, keyed by kind — what a fan-out consults before it asks for anything. */
export type VantaParentIds = ReadonlyMap<VantaKind, VantaParentRead>;

/** One parent the provider itself refused this surface for, with the words it used. */
interface RefusedParent {
  readonly parentId: string;
  readonly reason: string;
}

/** What one child surface's fan-out produced: the rows, and every parent the provider bounded. */
interface ChildWalk {
  readonly rows: readonly ChildRow[];
  readonly refused: readonly RefusedParent[];
  readonly asked: number;
}

/** The parent kinds whose read must have completed before a child family may be judged complete. */
function parentKindsOf({ family }: { family: VantaChildFamily }): readonly VantaKind[] {
  return [...new Set(family.surfaces.map((surface) => surface.parentKind))];
}

/**
 * Why a fan-out cannot run: the parent's own reasons, prefixed with which parent they came from, graded as
 * the most specific gap the parent's own failed attempts opened.
 */
function parentRefusal({
  parentKind,
  surface,
  read,
}: {
  parentKind: VantaKind;
  surface: string;
  read: VantaParentRead | undefined;
}): VantaSurfaceError {
  const failed = read === undefined || read.outcome === "read" ? null : read;
  const refusal = VantaSyncErrors.parentFanOutRefused({
    parentKind,
    parentReasons: failed === null ? null : failed.reasons,
    surface,
  });
  return VantaSurfaceErrors.inheritedFrom({
    conditions: failed === null ? [] : failed.conditions,
    reasons: vantaSyncErrorLines({ error: refusal }),
  });
}

/**
 * Walk one child surface across every parent, concatenating the rows with the parent that answered them.
 *
 * Deliberately sequential rather than concurrent: `transport.ts` carries this atlas's whole rate-limit
 * behaviour, and a fan-out that opens one request per vendor is exactly where a burst would first be felt.
 */
async function walkChildSurface({
  client,
  surface,
  parentIds,
}: {
  client: VantaAtlasSyncClient;
  surface: VantaChildSurface;
  parentIds: readonly string[];
}): Promise<Result<ChildWalk, VantaSurfaceError>> {
  const rows: ChildRow[] = [];
  const refused: RefusedParent[] = [];
  for (const parentId of parentIds) {
    const answered = await client.listChildSurface({ parentId, surface: surface.surface });
    if (answered.isErr()) {
      const failed = VantaSyncErrors.childParentFailed({
        parentId,
        parentKind: surface.parentKind,
        surface: surface.surface,
        upstream: answered.error.reasons,
      });
      // Named for the parent it failed on, graded as the parent's own call was.
      return err(
        VantaSurfaceErrors.regraded({ reasons: vantaSyncErrorLines({ error: failed }), upstream: answered.error }),
      );
    }
    if (answered.value.boundedByProvider) {
      refused.push({ parentId, reason: answered.value.because });
      continue;
    }
    for (const dto of answered.value.rows) {
      rows.push({ dto, parentId });
    }
  }
  if (refused.length === parentIds.length && parentIds.length > 0) {
    // Every parent bounded is not a partial answer — it is NO answer, and publishing it would say this
    // organisation holds none of these. A ceiling is tolerated because SOME parent still answers; when none
    // does, the surface has gone away and the kind must fail so its stored entities are left alone. A Codex
    // review pass found this hole by walking the all-refused case, which the one measured refusal never
    // reaches on today's tenant.
    const absent = VantaSyncErrors.childSurfaceAbsent({
      asked: parentIds.length,
      parentKind: surface.parentKind,
      refused,
      surface: surface.surface,
    });
    return err(VantaSurfaceErrors.detailUnreadable({ reasons: vantaSyncErrorLines({ error: absent }) }));
  }
  return ok({ asked: parentIds.length, refused, rows });
}

/** What one child surface contributed to its family's fold: the attempt, its entities, and its gaps. */
interface ChildSurfaceOutcome {
  readonly attempt: SurfaceAttempt<ChildRow>;
  readonly entities: readonly VantaEntity[];
  readonly gaps: readonly VantaGap[];
  readonly rechecks: readonly VantaGapRecheck[];
}

/** Fan one surface out over its parents and turn the walk into an attempt, entities and gaps. */
async function syncChildSurface({
  client,
  family,
  surface,
  parentIds,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  family: VantaChildFamily;
  surface: VantaChildSurface;
  parentIds: VantaParentIds;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<ChildSurfaceOutcome>> {
  // Declared BEFORE the walk: the fan-out asks the provider once per parent, and an undeclared surface asks none.
  const declared = roleFor({ kind: family.kind, surface: surface.surface });
  if (declared.isErr()) {
    return err(vantaSyncErrorLines({ error: declared.error }));
  }
  const parents = parentIds.get(surface.parentKind);
  const walked =
    parents?.outcome === "read"
      ? await walkChildSurface({ client, parentIds: parents.ids, surface })
      : err<ChildWalk, VantaSurfaceError>(
          parentRefusal({ parentKind: surface.parentKind, read: parents, surface: surface.surface }),
        );
  const attempted = await attemptSurface<ChildRow>({
    at,
    fetch: () => Promise.resolve(walked.map((walk) => walk.rows)),
    kind: family.kind,
    previousCoverage: findCoverageCell({ coverage: stored.coverage, surface: surface.surface }),
    surface: surface.surface,
  });
  if (attempted.isErr()) {
    return err(attempted.error);
  }
  const attempt = attempted.value;
  const refused = walked.isOk() ? walked.value.refused : [];
  const rows = attemptItems({ attempt });
  const shapes = undeclaredShapeGaps({ at, family, rows, stored, surface, walkedWhole: walked.isOk() });
  return ok({
    attempt: walked.isOk() ? withFanOutReason({ attempt, walk: walked.value }) : attempt,
    entities: rows.map((row) => projectVantaChildRow({ at, dto: row.dto, family, parentId: row.parentId, surface })),
    gaps: [
      ...refused.map((refusal) =>
        openVantaGap({
          at,
          channel: "manage-api",
          condition: "child-surface-unsupported-for-parent",
          kind: family.kind,
          reason: `${surface.parentKind} ${refusal.parentId} cannot serve ${surface.surface}: ${refusal.reason}`,
          scope: `${surface.surface}:${refusal.parentId}`,
        }),
      ),
      ...shapes.gaps,
    ],
    rechecks: shapes.rechecks,
  });
}

/** Sync one child family: every surface, fanned out over every parent, folded as one kind. */
async function syncChildFamily({
  client,
  family,
  parentIds,
  stored,
  at,
}: {
  client: VantaAtlasSyncClient;
  family: VantaChildFamily;
  parentIds: VantaParentIds;
  stored: VantaKindFile;
  at: string;
}): Promise<Result<KindSyncResult>> {
  const missingParent = parentKindsOf({ family }).find((kind) => parentIds.get(kind)?.outcome !== "read");
  const outcomes: ChildSurfaceOutcome[] = [];
  for (const surface of family.surfaces) {
    const outcome = await syncChildSurface({ at, client, family, parentIds, stored, surface });
    if (outcome.isErr()) {
      return err(outcome.error);
    }
    outcomes.push(outcome.value);
  }
  const folded = foldKindSync({
    at,
    attempts: outcomes.map((outcome) => outcome.attempt),
    kind: family.kind,
    observedEntities: outcomes.flatMap((outcome) => outcome.entities),
    stored,
  });
  if (folded.isErr()) {
    return folded;
  }
  const withGaps = reconcileVantaGaps({
    at,
    observed: outcomes.flatMap((outcome) => outcome.gaps),
    rechecks: outcomes.flatMap((outcome) => outcome.rechecks),
    runFailed: !folded.value.complete,
    stored: folded.value.file.gaps,
  });
  if (withGaps.isErr()) {
    return err(withGaps.error);
  }
  const result = { ...folded.value, file: { ...folded.value.file, gaps: [...withGaps.value] } };
  return ok(missingParent === undefined ? result : { ...result, complete: false });
}

/**
 * Say how many parents ANSWERED out of how many were asked, on the coverage cell itself.
 *
 * `attemptSurface` writes "N record(s) read", which is the right sentence for a family read in one request
 * and the wrong one for a fan-out: a surface most of whose parents refused would report a row
 * count and read exactly like a surface that is simply small. The fraction is what makes a spreading
 * ceiling visible, so it goes where a reader is already looking.
 */
function withFanOutReason({ attempt, walk }: { attempt: SurfaceAttempt<ChildRow>; walk: ChildWalk }): typeof attempt {
  const answered = walk.asked - walk.refused.length;
  return {
    ...attempt,
    coverageCell: {
      ...attempt.coverageCell,
      reason: `${String(walk.rows.length)} record(s) read across ${String(answered)} of ${String(walk.asked)} ${
        walk.refused.length === 0 ? "parent(s)" : "parent(s) — the rest the provider itself bounded"
      }`,
    },
  };
}

/**
 * A runner per child kind, keyed by kind.
 *
 * @param client the bound sync client
 * @param storedFiles the previous generation's file per kind, merged against on a complete read
 * @param parentIds this run's freshly-read provider ids, per parent kind
 * @param at this run's ISO timestamp
 * @returns one runner per kind this file owns
 */
export function vantaChildRunners({
  client,
  storedFiles,
  parentIds,
  at,
}: {
  client: VantaAtlasSyncClient;
  storedFiles: Readonly<Record<VantaChildKind, VantaKindFile>>;
  parentIds: () => VantaParentIds;
  at: string;
}): Record<VantaChildKind, () => Promise<Result<KindSyncResult>>> {
  const child =
    ({ kind }: { kind: VantaChildKind }): (() => Promise<Result<KindSyncResult>>) =>
    () =>
      syncChildFamily({
        at,
        client,
        family: VANTA_CHILD_FAMILIES[kind],
        parentIds: parentIds(),
        stored: storedFiles[kind],
      });
  return {
    "control-document-link": child({ kind: "control-document-link" }),
    "discovered-vendor-account": child({ kind: "discovered-vendor-account" }),
    "document-link": child({ kind: "document-link" }),
    "document-upload": child({ kind: "document-upload" }),
    "framework-control-link": child({ kind: "framework-control-link" }),
    "group-member": child({ kind: "group-member" }),
    "integration-resource": child({ kind: "integration-resource" }),
    "integration-resource-kind": child({ kind: "integration-resource-kind" }),
    "risk-control-link": child({ kind: "risk-control-link" }),
    "vendor-assessment": child({ kind: "vendor-assessment" }),
    "vendor-document": child({ kind: "vendor-document" }),
    "vendor-security-review": child({ kind: "vendor-security-review" }),
  };
}
