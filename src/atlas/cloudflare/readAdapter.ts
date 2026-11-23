/**
 * Cloudflare's projection into the kit's normalized read view.
 *
 * Reads the atlas's own strict store and reshapes it — nothing here parses JSON, repairs a generation or
 * reaches Cloudflare. The one judgement it makes is how this platform's vocabulary maps onto the shared
 * one, and there are exactly three such mappings worth stating:
 *
 * - **One observation, not two.** This atlas has a single acquisition channel (`model.ts`'s
 *   `CLOUDFLARE_CHANNEL`), so every entity projects to exactly one {@link AtlasObservationView}. That is a
 *   fact about the atlas, not a limit of the view: Vanta's adapter next door returns up to two.
 * - **Every deep link is `unverified`, and that is the honest value.** `descriptor.ts` records why in full:
 *   Cloudflare's REST API returns no dashboard link on any surface this atlas reads, and one assembled from
 *   an account, zone and resource id would be a link this code invented. The view therefore carries `null`
 *   with a status that says nobody has looked, rather than a constructed URL that reads as provenance.
 * - **`scope` is rendered, never parsed back.** The stored scope is three optional ids; a reader wants one
 *   string it can eyeball and grep. {@link renderCloudflareScope} is the only place that shape is flattened.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasCoverageCellView,
  type AtlasEntityView,
  type AtlasGapView,
  type AtlasKindView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
} from "../kit/read.js";
import { CLOUDFLARE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  CLOUDFLARE_ATLAS_PLATFORM,
  CLOUDFLARE_ATLAS_SCHEMA_VERSION,
  CLOUDFLARE_KINDS,
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKind,
  type CloudflareKindFile,
  type CloudflareKindStatus,
  type CloudflareManifest,
} from "./model.js";
import { cloudflareAtlasPaths, readCloudflareAtlas } from "./store.js";

/** What the kit's surface name is for this atlas's one channel — the descriptor's own `rest-api`. */
const REST_SURFACE = "rest-api";

/**
 * The three optional scope ids as one greppable string.
 *
 * @param scope the entity's stored scope
 * @returns `account/<id>`, extended with `/zone/<id>` and `/parent/<id>` when those are present
 */
export function renderCloudflareScope({ scope }: { scope: CloudflareEntity["scope"] }): string {
  const parts = [`account/${scope.accountId}`];
  if (scope.zoneId !== null) {
    parts.push(`zone/${scope.zoneId}`);
  }
  if (scope.parentId !== null) {
    parts.push(`parent/${scope.parentId}`);
  }
  return parts.join("/");
}

/**
 * Project one stored entity.
 *
 * @param entity the stored entity
 * @returns its normalized view
 */
export function cloudflareEntityView({ entity }: { entity: CloudflareEntity }): AtlasEntityView {
  return {
    detail: entity.detail,
    id: entity.id,
    kind: entity.kind,
    observations: [
      {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: entity.source.operation,
        observedAt: entity.source.observedAt,
        state: entity.state,
        surface: REST_SURFACE,
      },
    ],
    providerId: entity.providerId,
    scope: renderCloudflareScope({ scope: entity.scope }),
  };
}

/**
 * Project one stored gap.
 *
 * @param gap the stored gap
 * @returns its normalized view
 */
function cloudflareGapView({ gap }: { gap: CloudflareGap }): AtlasGapView {
  return {
    condition: gap.condition,
    id: gap.id,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
  };
}

/**
 * Project one kind's coverage cells, stamping the surface this atlas's cells predate carrying.
 *
 * The stored cell has no `surface` field — `coverage.ts` records that it was written when this platform had
 * exactly one channel and one evidence role, so a cell carried neither. Naming it here rather than adding a
 * field to disk keeps that decision where it was made and costs no install a forced reset.
 *
 * @param file the kind file whose cells to project
 * @returns the normalized cells
 */
function cloudflareCoverageViews({ file }: { file: CloudflareKindFile }): readonly AtlasCoverageCellView[] {
  return file.coverage.map((cell) => ({
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    reason: cell.reason,
    scope: cell.scope,
    state: cell.state,
    surface: REST_SURFACE,
    unblockedBy: cell.unblockedBy,
  }));
}

/**
 * What the manifest records about one kind, or `null` before anything has been published: there is no manifest
 * until a first generation lands, and a published one carries every kind, because a `z.record` keyed by an
 * enum is exhaustive.
 *
 * @param manifest the published manifest, `null` when nothing has been published
 * @param kind the kind to look up
 * @returns the kind's status, or `null` for an atlas with no manifest yet
 */
function publishedKindStatus({
  manifest,
  kind,
}: {
  manifest: CloudflareManifest | null;
  kind: CloudflareKind;
}): CloudflareKindStatus | null {
  if (manifest === null) {
    return null;
  }
  return manifest.kinds[kind];
}

/**
 * How many entities the manifest says a kind published — zero for a kind with no status, because a kind that
 * was never published has published nothing.
 *
 * @param status the kind's status, `null` before anything has been published
 * @returns the published entity count
 */
function publishedEntityCount({ status }: { status: CloudflareKindStatus | null }): number {
  if (status === null) {
    return 0;
  }
  return status.entityCount;
}

/**
 * When the published generation was stamped, or `null` when nothing has been published yet.
 *
 * @param manifest the published manifest, `null` when nothing has been published
 * @returns the manifest's own timestamp, or `null`
 */
function generationUpdatedAt({ manifest }: { manifest: CloudflareManifest | null }): string | null {
  if (manifest === null) {
    return null;
  }
  return manifest.updatedAt;
}

/**
 * Read the Cloudflare atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readCloudflareSnapshot({
  home,
}: {
  home?: string;
} = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  // `stateHomePaths` owns the `$SLOPWEAVER_HOME` default; resolving it here rather than reaching for the
  // env var keeps one answer to "which home" across every verb.
  const paths = cloudflareAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readCloudflareAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: CLOUDFLARE_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = CLOUDFLARE_KINDS.map((kind: CloudflareKind): AtlasKindView => {
    const file = files[kind];
    const status = publishedKindStatus({ kind, manifest });
    return {
      coverage: file === null ? [] : cloudflareCoverageViews({ file }),
      entities: file === null ? [] : file.entities.map((entity) => cloudflareEntityView({ entity })),
      gaps: file === null ? [] : file.gaps.map((gap) => cloudflareGapView({ gap })),
      kind,
      lastSuccessAt: unsetFieldAsNull({ key: "lastSuccessAt", record: status }),
      latestAttemptFailed: status?.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
      publishedCount: publishedEntityCount({ status }),
    };
  });
  return ok({
    descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: CLOUDFLARE_ATLAS_PLATFORM,
      schemaVersion: CLOUDFLARE_ATLAS_SCHEMA_VERSION,
      updatedAt: generationUpdatedAt({ manifest }),
      superseded,
      unpublished,
    },
    kinds,
  });
}
