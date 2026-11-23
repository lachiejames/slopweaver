/**
 * Shared fold infrastructure every kind's `syncXKind` function builds on rather than repeating.
 *
 * Split out of `sync.ts` once a fourth non-flat kind (`pages-project`) would have pushed that file over the
 * repo's file-size ratchet. Every kind-specific `syncXKind` now lives in its own `<kind>Sync.ts` module
 * beside its own reader imports, so this one owns only what all of them share — including the two folds a
 * FLAT kind needs ({@link foldSucceededKindRead}, {@link foldFailedKindRead}) and the manifest stamp every
 * kind needs ({@link stampKindAttempt}), which arrived here when `sync.ts` was finally split whole. The
 * steps only a parent-inventory kind adds — its fan-out read, its parent scope and its per-parent gap inputs
 * — live in `parentFanoutFold.ts`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { failedKindStatus, succeededKindStatus } from "../kit/kindStatus.js";
import { withKindStatus } from "../kit/manifestClock.js";
import {
  type CloudflareCoverageCell,
  failedCloudflareCoverageCell,
  priorCoverageCell,
  succeededCloudflareCoverageCell,
} from "./coverage.js";
import type { CloudflareClientError } from "./errors.js";
import {
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
  recheckEveryCondition,
  reconcileCloudflareGaps,
} from "./gaps.js";
import { mergeCloudflareKind, withStoredFirstSeen } from "./merge.js";
import type {
  CloudflareEntity,
  CloudflareGap,
  CloudflareKind,
  CloudflareKindFile,
  CloudflareManifest,
} from "./model.js";

/** How this run's attempt at one kind resolved. */
export interface CloudflareSyncKindOutcome {
  readonly kind: CloudflareKind;
  readonly complete: boolean;
  readonly entityCount: number;
  readonly reasons: readonly string[];
  /**
   * Set when this kind failed ONLY because the configured token may not see it. See
   * `atlas/kit/store.ts`'s `AtlasPermissionBlock` for the owner ruling that made this first-class.
   */
  readonly permissionBlocked?: { readonly detail: string; readonly unblockedBy: string } | null;
}

/** What a Cloudflare reader is told to do about a token that cannot see a surface. */
const CLOUDFLARE_TOKEN_REMEDY =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/**
 * Whether this run's own gaps say the kind is dark for PERMISSIONS alone, and what would lift that.
 *
 * Derived from the gaps rather than from a new argument threaded through eight fan-out call sites, because
 * the gaps already carry the typed classification: `classifyCloudflareClientErrorGap` turns a
 * {@link CloudflarePermissionError} into `permission-refused` and every other client error into something
 * else. Every open gap has to be that one condition — a kind refused on one scope and broken on another is
 * a boundary AND a defect, and calling it the first would exempt it from the kit's publish gate on the
 * strength of a failure a later run could clear.
 *
 * Spread into the outcome rather than set to `null`, so a complete kind's outcome is unchanged — several
 * suites compare a whole outcome object.
 *
 * @param complete whether this run's read finished, in which case there is no boundary to report
 * @param gaps the gaps this fold is publishing for the kind
 * @returns the field to spread into the outcome, empty when this is not purely a permission boundary
 */
function permissionBlockedField({ complete, gaps }: { complete: boolean; gaps: readonly CloudflareGap[] }): {
  readonly permissionBlocked?: { readonly detail: string; readonly unblockedBy: string };
} {
  if (complete) {
    return {};
  }
  const boundary = permissionBoundaryFromGaps({ gaps });
  return boundary === null ? {} : { permissionBlocked: boundary };
}

/**
 * Whether this run's own gaps say the kind is dark for PERMISSIONS alone, and what would lift that.
 *
 * @param gaps the gaps this fold is publishing for the kind
 * @returns the boundary's detail and remedy, or `null` when this is not purely a permission boundary
 */
function permissionBoundaryFromGaps({ gaps }: { gaps: readonly CloudflareGap[] }): {
  readonly detail: string;
  readonly unblockedBy: string;
} | null {
  const open = gaps.filter((gap) => gap.status === "open");
  if (open.length === 0 || !open.every((gap) => gap.condition === "permission-refused")) {
    return null;
  }
  return { detail: open.map((gap) => `${gap.scope}: ${gap.reason}`).join("; "), unblockedBy: CLOUDFLARE_TOKEN_REMEDY };
}

/** One kind's fold result: the file to publish, and what happened. */
export interface KindFoldResult {
  readonly file: CloudflareKindFile;
  readonly outcome: CloudflareSyncKindOutcome;
}

/**
 * The scope string one flat kind's coverage cell and gaps are recorded under.
 *
 * @param kind the kind this scope is for
 * @param accountId the selected account id
 * @returns the scope string
 */
export function flatKindScope({ kind, accountId }: { kind: CloudflareKind; accountId: string }): string {
  return `account/${accountId}/${kind}`;
}

/**
 * The scope string one deep-zone-only flat kind's coverage cell and gaps are recorded under — `zone/...`
 * rather than `account/...`, since these facts belong to the one configured deep zone, not the account.
 *
 * @param kind the kind this scope is for
 * @param zoneId the configured deep zone's id
 * @returns the scope string
 */
export function deepZoneKindScope({ kind, zoneId }: { kind: CloudflareKind; zoneId: string }): string {
  return `zone/${zoneId}/${kind}`;
}

/**
 * Fold a failed read into the stored file: coverage and gaps update, entities are left untouched.
 *
 * @param kind the kind this read was for
 * @param stored the kind file as it stood before this run
 * @param scope the coverage scope this kind is recorded under
 * @param error why the read failed
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's (failed) outcome
 */
export function foldFailedKindRead({
  kind,
  stored,
  scope,
  error,
  at,
}: {
  kind: CloudflareKind;
  stored: CloudflareKindFile;
  scope: string;
  error: CloudflareClientError;
  at: string;
}): KindFoldResult {
  const cell = failedCloudflareCoverageCell({
    previous: priorCoverageCell({ coverage: stored.coverage, scope }),
    reason: error.message,
    scope,
    state: "unreadable",
    unblockedBy: null,
  });
  const gap = openCloudflareGap({
    at,
    condition: classifyCloudflareClientErrorGap({ error }),
    kind,
    reason: error.message,
    scope,
  });
  const gaps = reconcileCloudflareGaps({ at, observed: [gap], rechecks: [], runFailed: true, stored: stored.gaps });
  return {
    file: {
      ...stored,
      coverage: [...stored.coverage.filter((existing) => existing.scope !== scope), cell],
      gaps: gaps.isOk() ? [...gaps.value] : stored.gaps,
      updatedAt: at,
    },
    // Present only when there IS a boundary: an outcome is compared whole by several suites, and a key
    // spelled `null` on every kind would make the common case noisier to read for no gain.
    outcome: {
      complete: false,
      entityCount: stored.entities.length,
      kind,
      reasons: [error.message],
      ...(error.kind === "permission"
        ? { permissionBlocked: { detail: error.message, unblockedBy: CLOUDFLARE_TOKEN_REMEDY } }
        : {}),
    },
  };
}

/**
 * Build this run's coverage cell for a non-flat kind's own scope, from a fan-out reconciliation's outcome —
 * shared by `access-policy`'s bipartite reconciliation and every parent-fanout kind's simpler one.
 *
 * @param complete whether this run's reconciliation was complete
 * @param reasons every reason this run's reconciliation was incomplete, if it was
 * @param successReason the coverage reason to record on a complete run
 * @param stored the kind file as it stood before this run
 * @param scope the coverage scope this kind is recorded under
 * @param at this run's ISO timestamp
 * @returns the succeeded or failed coverage cell for this run
 */
export function buildFanoutCoverageCell({
  complete,
  reasons,
  successReason,
  stored,
  scope,
  at,
}: {
  complete: boolean;
  reasons: readonly string[];
  successReason: string;
  stored: CloudflareKindFile;
  scope: string;
  at: string;
}): CloudflareCoverageCell {
  return complete
    ? succeededCloudflareCoverageCell({ at, reason: successReason, scope, state: "synced" })
    : failedCloudflareCoverageCell({
        previous: priorCoverageCell({ coverage: stored.coverage, scope }),
        reason: reasons.join("; "),
        scope,
        state: "unreadable",
        unblockedBy: null,
      });
}

/**
 * Every stored entity belonging to one zone — what a zone-scoped read is allowed to preserve or replace.
 *
 * A fan-out kind's per-subtype fold preserves its own previously-stored entities when its read fails, and
 * `reconcileParentFanout` looks a failed parent's prior children up by `providerId`. Neither is safe over a
 * store holding more than one zone: several of these id spaces repeat per zone (`model.ts`'s
 * `CLOUDFLARE_ZONE_SCOPED_KINDS`), so an unfiltered lookup preserves another zone's record under this
 * zone's identity, and an unfiltered subtype filter re-emits every zone's copy — which, now that the id
 * carries the zone, is the duplicate-id refusal in `kit/merge.ts` rather than a silent overwrite.
 *
 * @param stored the kind file as it stood before this run
 * @param zoneId the zone to keep
 * @returns that zone's stored entities, in stored order
 */
export function entitiesInZone({
  stored,
  zoneId,
}: {
  stored: CloudflareKindFile;
  zoneId: string;
}): readonly CloudflareEntity[] {
  return stored.entities.filter((entity) => entity.scope.zoneId === zoneId);
}

/**
 * This run's entity list for one zone-scoped NON-FLAT kind, with every OTHER zone's stored entities carried
 * forward unchanged.
 *
 * The five deep-zone fan-out kinds do not merge — each one's own per-subtype fold decides what survives, and
 * the result REPLACES the kind file's entity array wholesale. That is right for the zone that was read and
 * catastrophic for every zone that was not: a per-zone loop would have each zone's publication delete the
 * previous zone's entities outright, which is worse than the merge's staling because nothing is left to say
 * the data was ever there. So the zones this run did not look at are prepended verbatim.
 *
 * An entity stored under this kind with NO zone at all cannot have come from a build that writes the current
 * schema, and is dropped rather than carried into a generation that cannot say which zone it belongs to —
 * see `model.ts` on why a v1 generation is superseded rather than migrated.
 *
 * @param stored the kind file as it stood before this run
 * @param zoneId the one zone this run read
 * @param entities this run's own reconciled entities for that zone
 * @returns every other zone's stored entities, then this run's
 */
export function withOtherZonesRetained({
  stored,
  zoneId,
  entities,
}: {
  stored: CloudflareKindFile;
  zoneId: string;
  entities: readonly CloudflareEntity[];
}): readonly CloudflareEntity[] {
  const others = stored.entities.filter((entity) => entity.scope.zoneId !== null && entity.scope.zoneId !== zoneId);
  return [...others, ...entities];
}

/**
 * Build one non-flat kind's fold result — the file to publish and its outcome — from a reconciliation's own
 * entities, coverage cell and gaps. Shared by every non-flat kind's `syncXKind` function. An entity already
 * stored keeps its `firstSeenAt` (see {@link withStoredFirstSeen}).
 *
 * @param stored the kind file as it stood before this run
 * @param scope the coverage scope this kind is recorded under
 * @param cell this run's coverage cell for that scope
 * @param entities this run's reconciled entities
 * @param gaps this run's accumulated gap list
 * @param at this run's ISO timestamp
 * @param kind the kind this result is for
 * @param complete whether this run's reconciliation was complete
 * @param reasons every reason this run's reconciliation was incomplete, if it was
 * @returns the file to publish and this run's outcome
 */
function buildKindFoldResult({
  stored,
  scope,
  cell,
  entities,
  gaps,
  at,
  kind,
  complete,
  reasons,
}: {
  stored: CloudflareKindFile;
  scope: string;
  cell: CloudflareCoverageCell;
  entities: readonly CloudflareEntity[];
  gaps: readonly CloudflareGap[];
  at: string;
  kind: CloudflareKind;
  complete: boolean;
  reasons: readonly string[];
}): KindFoldResult {
  return {
    file: {
      ...stored,
      coverage: [...stored.coverage.filter((existing) => existing.scope !== scope), cell],
      entities: withStoredFirstSeen({ entities, stored: stored.entities }),
      gaps: [...gaps],
      updatedAt: at,
    },
    outcome: { complete, entityCount: entities.length, kind, reasons, ...permissionBlockedField({ complete, gaps }) },
  };
}

/**
 * Reconcile this run's observed gaps against what is stored, then build one non-flat kind's fold result —
 * the last two steps every `syncXKind` function otherwise repeats verbatim. A kind gated on an inventory read
 * at its own `scope` passes `kindScopeRead: "succeeded"` once that read has, so every condition there is
 * rechecked and the gap a failed one opened through {@link foldFailedKindRead} closes. A kind that makes no
 * read at that scope passes `"not-made"`, so nothing there closes on the strength of its subtype reads.
 *
 * @param at this run's ISO timestamp
 * @param kind the kind this result is for
 * @param scope the coverage scope this kind is recorded under
 * @param kindScopeRead whether an inventory read at `scope` succeeded this run, or none is made there
 * @param stored the kind file as it stood before this run
 * @param cell this run's coverage cell for that scope
 * @param entities this run's reconciled entities
 * @param complete whether this run's reconciliation was complete
 * @param reasons every reason this run's reconciliation was incomplete, if it was
 * @param gapInputs this run's observed gaps and earned rechecks
 * @returns the file to publish and this run's outcome, or why the gap reconciliation itself failed
 */
export function foldFanoutResult({
  at,
  kind,
  scope,
  kindScopeRead,
  stored,
  cell,
  entities,
  complete,
  reasons,
  gapInputs,
}: {
  at: string;
  kind: CloudflareKind;
  scope: string;
  kindScopeRead: "succeeded" | "not-made";
  stored: CloudflareKindFile;
  cell: CloudflareCoverageCell;
  entities: readonly CloudflareEntity[];
  complete: boolean;
  reasons: readonly string[];
  gapInputs: { observed: readonly CloudflareGap[]; rechecks: readonly CloudflareGapRecheck[] };
}): Result<KindFoldResult> {
  const kindRechecks = kindScopeRead === "succeeded" ? recheckEveryCondition({ scope }) : [];
  return reconcileCloudflareGaps({
    at,
    observed: gapInputs.observed,
    rechecks: [...gapInputs.rechecks, ...kindRechecks],
    runFailed: false,
    stored: stored.gaps,
  }).map((gaps) => buildKindFoldResult({ at, cell, complete, entities, gaps, kind, reasons, scope, stored }));
}

/**
 * Fold a successful flat read into the stored file: entities merge, coverage succeeds, and every gap
 * recorded against this scope closes — the read having succeeded is what rechecks each of them.
 *
 * @param kind the kind this read was for
 * @param label what a successful read's coverage reason names, e.g. "zone(s)"
 * @param stored the kind file as it stood before this run
 * @param scope the coverage scope this kind is recorded under
 * @param observed this run's freshly projected entities
 * @param readZoneId the one zone this run read, for a zone-scoped kind, or `null` for an account-scoped one
 *   — see `merge.ts` on why a zone-scoped read may only stale its own zone
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the merge itself failed
 */
export function foldSucceededKindRead({
  kind,
  label,
  stored,
  scope,
  observed,
  readZoneId,
  at,
}: {
  kind: CloudflareKind;
  label: string;
  stored: CloudflareKindFile;
  scope: string;
  observed: readonly CloudflareEntity[];
  readZoneId: string | null;
  at: string;
}): Result<KindFoldResult> {
  const merged = mergeCloudflareKind({ at, observed, readZoneId, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const cell = succeededCloudflareCoverageCell({
    at,
    reason: `read ${String(observed.length)} ${label}`,
    scope,
    state: "synced",
  });
  const rechecks = recheckEveryCondition({ scope });
  const gaps = reconcileCloudflareGaps({ at, observed: [], rechecks, runFailed: false, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    file: {
      ...stored,
      coverage: [...stored.coverage.filter((existing) => existing.scope !== scope), cell],
      entities: [...merged.value],
      gaps: [...gaps.value],
      updatedAt: at,
    },
    outcome: { complete: true, entityCount: merged.value.length, kind, reasons: [] },
  });
}

/**
 * The manifest status this run's outcome earns for one kind — `lastSuccessAt`/`lastAttempt` only, since
 * `publishCloudflareAtlas`'s own digest-stamping is what sets `digest`/`entityCount` from the bytes actually
 * written. Without this, `readCloudflareAtlas` would report the kind as perpetually "unpublished" — a kind
 * file can hold a real digest and still read that way if the manifest never learns a run succeeded.
 *
 * The manifest cell is replaced by the kit's `withKindStatus`; this atlas no longer carries its own copy of
 * that spread. See `kit/manifestClock.ts` for the drift the three private copies produced.
 *
 * @param manifest the manifest as it stood before this run
 * @param outcome this run's outcome for the kind
 * @param at this run's ISO timestamp
 * @returns the manifest with this kind's attempt/success fields updated
 */
export function stampKindAttempt({
  manifest,
  outcome,
  at,
}: {
  manifest: CloudflareManifest;
  outcome: CloudflareSyncKindOutcome;
  at: string;
}): CloudflareManifest {
  const status = manifest.kinds[outcome.kind];
  const entityCount = status.entityCount;
  const next = outcome.complete
    ? succeededKindStatus({ at, entityCount, reasons: [] })
    : failedKindStatus({ at, entityCount, lastSuccessAt: status.lastSuccessAt, reasons: outcome.reasons });
  return withKindStatus<CloudflareKind, CloudflareManifest>({
    kind: outcome.kind,
    manifest,
    status: {
      ...next,
      digest: status.digest,
      ...(outcome.permissionBlocked == null ? {} : { permissionBlocked: { at, ...outcome.permissionBlocked } }),
    },
  });
}
