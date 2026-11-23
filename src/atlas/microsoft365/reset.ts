/**
 * `atlas microsoft365 reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/microsoft365/`.
 *
 * The cached specification is NOT archived with it. It is named by the immutable commit it came from, so a
 * later generation built from the same pin finds the same bytes exactly where they were, and re-downloading
 * 44 MB to rebuild a generation that would be byte-identical is a cost with nothing on the other side of it.
 */
import type { Result } from "../../lib/result.js";
import { recordPerKind } from "../kit/kindRecord.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  emptyMicrosoft365KindFile,
  initialMicrosoft365Manifest,
  MICROSOFT365_KINDS,
  type Microsoft365AtlasKindFile,
  type Microsoft365Kind,
} from "./model.js";
import { MICROSOFT365_STORE_SPEC, type Microsoft365AtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type Microsoft365ResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyMicrosoft365Files({ at }: { at: string }): Readonly<Record<Microsoft365Kind, Microsoft365AtlasKindFile>> {
  return recordPerKind({
    kinds: MICROSOFT365_KINDS,
    valueFor: ({ kind }) => emptyMicrosoft365KindFile({ kind, updatedAt: at }),
  });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetMicrosoft365Atlas({
  paths,
  at,
}: {
  paths: Microsoft365AtlasPaths;
  at: string;
}): Result<Microsoft365ResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyMicrosoft365Files({ at }),
    emptyManifest: initialMicrosoft365Manifest({ updatedAt: at }),
    paths,
    spec: MICROSOFT365_STORE_SPEC,
  });
}
