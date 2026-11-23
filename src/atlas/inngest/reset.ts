/**
 * `atlas inngest reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/inngest/`, page
 * screenshots included, because a proof that survived the generation it belonged to would be a picture with
 * nothing to say what it was evidence for.
 */
import type { Result } from "../../lib/result.js";
import { recordPerKind } from "../kit/kindRecord.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  emptyInngestKindFile,
  INNGEST_KINDS,
  type InngestAtlasKindFile,
  type InngestKind,
  initialInngestManifest,
} from "./model.js";
import { INNGEST_STORE_SPEC, type InngestAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type InngestResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyInngestFiles({ at }: { at: string }): Readonly<Record<InngestKind, InngestAtlasKindFile>> {
  return recordPerKind({ kinds: INNGEST_KINDS, valueFor: ({ kind }) => emptyInngestKindFile({ kind, updatedAt: at }) });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetInngestAtlas({
  paths,
  at,
}: {
  paths: InngestAtlasPaths;
  at: string;
}): Result<InngestResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyInngestFiles({ at }),
    emptyManifest: initialInngestManifest({ updatedAt: at }),
    paths,
    spec: INNGEST_STORE_SPEC,
  });
}
