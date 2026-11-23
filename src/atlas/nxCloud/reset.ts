/**
 * `atlas nx-cloud reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/nx-cloud/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  emptyNxCloudKindFile,
  initialNxCloudManifest,
  type NxCloudAtlasKind,
  type NxCloudAtlasKindFile,
} from "./model.js";
import { NX_CLOUD_STORE_SPEC, type NxCloudAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type NxCloudResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyNxCloudFiles({ at }: { at: string }): Readonly<Record<NxCloudAtlasKind, NxCloudAtlasKindFile>> {
  return {
    endpoint: emptyNxCloudKindFile({ kind: "endpoint", updatedAt: at }),
    family: emptyNxCloudKindFile({ kind: "family", updatedAt: at }),
    organization: emptyNxCloudKindFile({ kind: "organization", updatedAt: at }),
    route: emptyNxCloudKindFile({ kind: "route", updatedAt: at }),
    workspace: emptyNxCloudKindFile({ kind: "workspace", updatedAt: at }),
  };
}

/**
 * Archive the current Nx Cloud atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetNxCloudAtlas({
  paths,
  at,
}: {
  paths: NxCloudAtlasPaths;
  at: string;
}): Result<NxCloudResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyNxCloudFiles({ at }),
    emptyManifest: initialNxCloudManifest({ updatedAt: at }),
    paths,
    spec: NX_CLOUD_STORE_SPEC,
  });
}
