/**
 * `atlas trelica reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/trelica/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { trelicaKindRecord } from "./kindRecord.js";
import {
  emptyTrelicaKindFile,
  initialTrelicaManifest,
  type TrelicaAtlasKind,
  type TrelicaAtlasKindFile,
} from "./model.js";
import { TRELICA_STORE_SPEC, type TrelicaAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type TrelicaResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyTrelicaFiles({ at }: { at: string }): Readonly<Record<TrelicaAtlasKind, TrelicaAtlasKindFile>> {
  return trelicaKindRecord({ of: (kind) => emptyTrelicaKindFile({ kind, updatedAt: at }) });
}

/**
 * Archive the current Trelica atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetTrelicaAtlas({
  paths,
  at,
}: {
  paths: TrelicaAtlasPaths;
  at: string;
}): Result<TrelicaResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyTrelicaFiles({ at }),
    emptyManifest: initialTrelicaManifest({ updatedAt: at }),
    paths,
    spec: TRELICA_STORE_SPEC,
  });
}
