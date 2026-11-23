/**
 * CrowdStrike's projection into the kit's normalized read view.
 *
 * Reads this atlas's own strict store and reshapes it — nothing here parses JSON, repairs a generation or
 * reaches CrowdStrike. Three mappings are this platform's own and worth stating:
 *
 * - **One observation per entity, and the surface it names is real.** Every kind is produced by exactly one
 *   surface: the API kinds by `falcon-api`, `console-page` and `console-request` by `falcon-console`. The
 *   entity's own `source.surface` is what the view reports, so a reader filtering `--surface falcon-console`
 *   gets the browser's work and not a stamp this adapter chose.
 * - **`scope` is the platform name.** A host has no account or zone above it — the API client is scoped to
 *   one tenant and every record in the generation belongs to it — so rendering anything finer would invent a
 *   hierarchy Falcon does not have. The tenant's own id is not stored, so the scope names the platform.
 * - **`detail` is the stored record itself.** Unlike the atlases that keep the provider's raw JSON, every
 *   field here already survived the projection allowlist, so the record IS the reviewed shape and handing
 *   back something else would mean storing the raw payload twice.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
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
import { CROWDSTRIKE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { CrowdstrikeEntity } from "./entities.js";
import { CROWDSTRIKE_KINDS, CROWDSTRIKE_PLATFORM, CROWDSTRIKE_SCHEMA_VERSION, type CrowdstrikeKind } from "./model.js";
import { crowdstrikeAtlasPaths, readCrowdstrikeAtlas } from "./store.js";

/**
 * Project one stored entity into the normalized view.
 *
 * @param entity the stored entity
 * @param kind the kind whose file it came from
 * @returns its normalized view
 *
 * @internal
 */
export function crowdstrikeEntityView({
  entity,
  kind,
}: {
  entity: CrowdstrikeEntity;
  kind: CrowdstrikeKind;
}): AtlasEntityView {
  return singleObservationView({ entity, kind, scope: CROWDSTRIKE_PLATFORM });
}

/**
 * Read the CrowdStrike atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readCrowdstrikeSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  // `stateHomePaths` owns the `$SLOPWEAVER_HOME` default; resolving it here rather than reaching for the
  // env var keeps one answer to "which home" across every verb.
  const paths = crowdstrikeAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readCrowdstrikeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: CROWDSTRIKE_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: CROWDSTRIKE_PLATFORM,
        remedy:
          "run: slopweaver crowdstrike sync — it reads the Falcon tenant through a read-only API client whose credential `slopweaver secrets status` names",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = CROWDSTRIKE_KINDS.map((kind: CrowdstrikeKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: "falcon-api" }),
      entities: file === null ? [] : file.entities.map((entity) => crowdstrikeEntityView({ entity, kind })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
      publishedCount: status.entityCount,
    };
  });
  return ok({
    descriptor: CROWDSTRIKE_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: CROWDSTRIKE_PLATFORM,
      schemaVersion: CROWDSTRIKE_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
