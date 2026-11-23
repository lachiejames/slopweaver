/**
 * Aether's projection into the kit's normalized read view.
 *
 * Reads this atlas's own strict store and reshapes it — nothing here parses a portal response, repairs a
 * generation or reaches Aether. Two mappings are this platform's own and worth stating:
 *
 * - **One surface, and every entity names it.** Aether has exactly one surface here — the driven browser —
 *   so every kind's `source.surface` is `aether-portal`, and a reader filtering `--surface aether-portal`
 *   gets the whole atlas rather than a stamp this adapter invented.
 * - **The descriptor is DERIVED, not the constant.** `descriptor.ts`'s `aetherDescriptorFor` computes the
 *   surface's status from the manifest, so `atlas aether coverage` on an install that has never walked
 *   reports it `declared-unfilled` from the ABSENCE of evidence rather than from a literal.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasEntityView,
  type AtlasKindView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
  coverageCellViews,
  gapViews,
  singleObservationView,
} from "../kit/read.js";

import { aetherDescriptorFor } from "./descriptor.js";
import type { AetherEntity, AetherManifest } from "./entities.js";
import { AETHER_KINDS, AETHER_PLATFORM, AETHER_SCHEMA_VERSION, type AetherKind } from "./model.js";
import { aetherAtlasPaths, readAetherAtlas } from "./store.js";

/**
 * Project one stored entity into the normalized view.
 *
 * @param entity the stored entity
 * @param kind the kind whose file it came from
 * @returns its normalized view
 *
 * @internal
 */
export function aetherEntityView({ entity, kind }: { entity: AetherEntity; kind: AetherKind }): AtlasEntityView {
  return singleObservationView({ entity, kind, scope: AETHER_PLATFORM });
}

/** The freshness fields a kind view carries, projected from its manifest status (or its absence). */
function statusView({ status }: { status: AetherManifest["kinds"][AetherKind] | null }): {
  lastSuccessAt: string | null;
  latestAttemptFailed: boolean;
  permissionBlocked: AtlasKindView["permissionBlocked"];
  publishedCount: number;
} {
  if (status === null) {
    return { lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 };
  }
  return {
    lastSuccessAt: status.lastSuccessAt,
    latestAttemptFailed: status.lastAttempt?.outcome === "failed",
    permissionBlocked: status.permissionBlocked === undefined ? null : status.permissionBlocked,
    publishedCount: status.entityCount,
  };
}

/**
 * Read the Aether atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readAetherSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = aetherAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readAetherAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: AETHER_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = AETHER_KINDS.map((kind: AetherKind): AtlasKindView => {
    const file = files[kind];
    const view = statusView({ status: manifest === null ? null : manifest.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: "aether-portal" }),
      entities: file === null ? [] : file.entities.map((entity) => aetherEntityView({ entity, kind })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      ...view,
    };
  });
  return ok({
    descriptor: aetherDescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: AETHER_PLATFORM,
      schemaVersion: AETHER_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest === null ? null : manifest.updatedAt,
    },
    kinds,
  });
}
