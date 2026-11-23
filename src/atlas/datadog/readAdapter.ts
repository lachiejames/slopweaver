/**
 * Datadog's projection into the kit's normalized read view.
 *
 * ## Why this exists, and why it landed before the sync did
 *
 * A descriptor on disk with no registry row is the 1Password failure `registryCoversEveryAtlas.test.ts` was
 * written to catch: that atlas synced its whole estate of entities and stayed unreachable through the read verb while
 * every test passed. So the seam landed with the descriptor rather than with the sync, and the platform has
 * been reachable from the moment it was declared.
 *
 * ## An unpublished atlas REFUSES rather than answering an empty snapshot
 *
 * `kit/store.ts`'s `readAtlas` SUCCEEDS over a directory that does not exist and hands back a null manifest,
 * which is right for a store and wrong for a reader: an empty snapshot answers "zero monitors" to a
 * question about this organisation's alerting, which is FALSE and indistinguishable from an organisation
 * with none.
 *
 * `kit/answerable.ts`'s `refuseUnanswerableAtlas` already catches that state for every atlas, applied by
 * `registry.ts` so no adapter can forget it — so the refusal below is NOT a second guard. It is the same
 * refusal raised earlier with a REMEDY only this platform can write: the generic one says "publish one with
 * the platform's own sync or walk verb", and a Datadog reader specifically needs to be told that the
 * 1,735-row registry is already committed to this build, that the sync needs no credential, and that a
 * successful sync still leaves two of the three surfaces unfilled.
 *
 * ## The descriptor is derived, never declared
 *
 * `surfaceFill.ts` computes the compiled-catalogue surface's status from the manifest and the `api`
 * surface's from the stored coverage cells, so a reader is told what THIS install has published rather than
 * what the source literal says every install has. That is why the kind FILES are handed over beside the
 * manifest: the manifest's per-kind `lastSuccessAt` is stamped by the compiled publish for every kind, so
 * it cannot tell a kind this organisation answered from one that was only ever compiled, and the `api`
 * coverage cell can. `console` is derived the same way, from the `console-page` kind's cell and open gaps
 * (`surfaceFill.ts`'s `datadogConsoleFill`), which `atlas datadog walk` writes.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  type AtlasKindView,
  type AtlasObservationView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
  channelObservations,
  coverageCellViews,
  firstChannelDetail,
  gapViews,
} from "../kit/read.js";
import { DATADOG_ATLAS_SCHEMA_VERSION, DATADOG_CHANNELS, type DatadogEntity } from "./documents.js";
import { DATADOG_ATLAS_PLATFORM, DATADOG_KINDS, type DatadogKind } from "./model.js";
import { readDatadogAtlas } from "./store.js";
import { datadogDescriptorFor } from "./surfaceFill.js";

/**
 * What a reader is told when no generation has been published.
 *
 * Three sentences, and `readAdapter.test.ts` asserts each: the reader has to learn the one command, that
 * the 1,735-row registry IS committed to this build, and that a sync fills ONE of the three surfaces.
 */
const DATADOG_UNPUBLISHED_REMEDY =
  "run `slopweaver atlas datadog sync`, which needs no credential and makes no request." +
  " The 1,735-operation registry is committed to this build and readable in" +
  " `src/atlas/datadog/generated/surfaces.ts`; what a sync creates is a GENERATION carrying it, which is" +
  " why this refuses rather than answering from source. The `api` and `console` surfaces stay" +
  " declared-unfilled after a sync, by design: nothing has been read from this organisation or from" +
  " the console until `sync --live` and `atlas datadog walk` run, and their coverage cells say so per kind";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function datadogObservations({ entity }: { entity: DatadogEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: DATADOG_CHANNELS });
}

/**
 * Read the Datadog atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why there is nothing to project
 */
export function readDatadogSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const snapshot = readDatadogAtlas(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: DATADOG_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: DATADOG_ATLAS_PLATFORM,
        remedy: DATADOG_UNPUBLISHED_REMEDY,
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = DATADOG_KINDS.map((kind: DatadogKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: DATADOG_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: DATADOG_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: datadogObservations({ entity }),
              providerId: entity.providerId,
              scope: entity.scope,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ record: status, key: "permissionBlocked" }),
      publishedCount: status.entityCount,
    };
  });
  return ok({
    descriptor: datadogDescriptorFor({ files, manifest }),
    generation: {
      mismatched,
      missing,
      platform: DATADOG_ATLAS_PLATFORM,
      schemaVersion: DATADOG_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
