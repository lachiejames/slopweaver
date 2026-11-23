/**
 * `atlas clerk reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/clerk/`.
 *
 * The cached documents are NOT archived with it. They are named by the immutable commit they came from, so
 * a later generation built from the same pin finds the same bytes exactly where they were, and
 * re-downloading 1.6 MB to rebuild a generation that would be byte-identical is a cost with nothing on the
 * other side of it. The page SCREENSHOTS are archived, because they are this generation's own evidence and
 * a walk is the only thing that can produce them again.
 */
import type { Result } from "../../lib/result.js";
import { recordPerKind } from "../kit/kindRecord.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  CLERK_ATLAS_KINDS,
  type ClerkAtlasKind,
  type ClerkAtlasKindFile,
  emptyClerkKindFile,
  initialClerkManifest,
} from "./model.js";
import { CLERK_STORE_SPEC, type ClerkAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type ClerkResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyClerkFiles({ at }: { at: string }): Readonly<Record<ClerkAtlasKind, ClerkAtlasKindFile>> {
  return recordPerKind({
    kinds: CLERK_ATLAS_KINDS,
    valueFor: ({ kind }) => emptyClerkKindFile({ kind, updatedAt: at }),
  });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetClerkAtlas({ paths, at }: { paths: ClerkAtlasPaths; at: string }): Result<ClerkResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyClerkFiles({ at }),
    emptyManifest: initialClerkManifest({ updatedAt: at }),
    paths,
    spec: CLERK_STORE_SPEC,
  });
}
