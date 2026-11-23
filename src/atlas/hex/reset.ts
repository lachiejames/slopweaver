/**
 * `atlas hex reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Hex's own is only
 * the shape of an EMPTY generation — one file per kind, so the freshly installed generation is complete
 * rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/hex/`.
 *
 * Screenshots are NOT archived with it. They are content-addressed by their own digest, so a later
 * generation referencing the same bytes finds them exactly where they were, and moving them would break
 * every artifact reference the archive itself carries.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyHexKindFile, type HexAtlasKind, type HexAtlasKindFile, initialHexManifest } from "./model.js";
import { HEX_STORE_SPEC, type HexAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type HexResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyHexFiles({ at }: { at: string }): Readonly<Record<HexAtlasKind, HexAtlasKindFile>> {
  return {
    api: emptyHexKindFile({ kind: "api", updatedAt: at }),
    method: emptyHexKindFile({ kind: "method", updatedAt: at }),
    page: emptyHexKindFile({ kind: "page", updatedAt: at }),
    project: emptyHexKindFile({ kind: "project", updatedAt: at }),
    resource: emptyHexKindFile({ kind: "resource", updatedAt: at }),
  };
}

/**
 * Archive the current Hex atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetHexAtlas({ paths, at }: { paths: HexAtlasPaths; at: string }): Result<HexResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyHexFiles({ at }),
    emptyManifest: initialHexManifest({ updatedAt: at }),
    paths,
    spec: HEX_STORE_SPEC,
  });
}
