/**
 * `atlas braze reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/braze/`.
 *
 * The documentation row cache goes with it. It lives under the same root the archive moves, so the first
 * sync after a reset finds no cached rows and fetches every documentation page again.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  BRAZE_KINDS,
  type BrazeAtlasKindFile,
  type BrazeKind,
  emptyBrazeKindFile,
  initialBrazeManifest,
} from "./model.js";
import { BRAZE_STORE_SPEC, type BrazeAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type BrazeResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyBrazeFiles({ at }: { at: string }): Readonly<Record<BrazeKind, BrazeAtlasKindFile>> {
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive BRAZE_KINDS, so the
  // narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(BRAZE_KINDS.map((kind) => [kind, emptyBrazeKindFile({ kind, updatedAt: at })])) as Record<
    BrazeKind,
    BrazeAtlasKindFile
  >;
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetBrazeAtlas({ paths, at }: { paths: BrazeAtlasPaths; at: string }): Result<BrazeResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyBrazeFiles({ at }),
    emptyManifest: initialBrazeManifest({ updatedAt: at }),
    paths,
    spec: BRAZE_STORE_SPEC,
  });
}
