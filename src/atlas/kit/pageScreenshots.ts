/**
 * The screenshots an atlas page shows: every stored page picture, once per digest.
 *
 * Apart from `./pageModel.ts` because it is the one pass over the entities that keeps the artifacts
 * themselves rather than counting them per surface (`./pageSurfaces.ts`), and the digest is what it keys on —
 * two pages photographing the same view are one picture here, whichever entity cited it first.
 */
import type { AtlasArtifactRef } from "./contract.js";
import type { AtlasEntityView, AtlasObservationView } from "./read.js";

/** One stored screenshot, addressed by the digest that proves the bytes are the ones that were seen. */
export interface AtlasPageScreenshot {
  readonly sha256: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly surface: string;
  readonly providerId: string;
  readonly deepLink: string | null;
}

/**
 * Every screenshot the atlas holds, deduplicated by digest and ordered smallest first, so a byte budget fits
 * more of them.
 *
 * @param entities every entity in the atlas, whose observations carry the artifacts
 * @returns one row per distinct page picture, the first entity citing a digest naming it
 */
export function atlasPageScreenshots({
  entities,
}: {
  entities: readonly AtlasEntityView[];
}): readonly AtlasPageScreenshot[] {
  const byDigest = new Map<string, AtlasPageScreenshot>();
  for (const entity of entities) {
    for (const observation of entity.observations) {
      for (const artifact of observation.artifacts) {
        if (artifact.kind !== "page-png" || byDigest.has(artifact.sha256)) {
          continue;
        }
        byDigest.set(artifact.sha256, screenshotOf({ artifact, entity, observation }));
      }
    }
  }
  return [...byDigest.values()].toSorted((left, right) => left.byteLength - right.byteLength);
}

/** One screenshot row. */
function screenshotOf({
  artifact,
  entity,
  observation,
}: {
  artifact: AtlasArtifactRef;
  entity: AtlasEntityView;
  observation: AtlasObservationView;
}): AtlasPageScreenshot {
  return {
    byteLength: artifact.byteLength,
    deepLink: observation.deepLink,
    mediaType: artifact.mediaType,
    providerId: entity.providerId,
    relativePath: artifact.relativePath,
    sha256: artifact.sha256,
    surface: observation.surface,
  };
}
