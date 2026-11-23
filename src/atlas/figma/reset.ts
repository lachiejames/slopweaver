/**
 * `atlas figma reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Figma's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/figma/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyFigmaKindFiles, initialFigmaManifest } from "./model.js";
import { FIGMA_STORE_SPEC, type FigmaAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type FigmaResetOutcome = AtlasResetOutcome;

/**
 * Archive the current Figma atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetFigmaAtlas({ paths, at }: { paths: FigmaAtlasPaths; at: string }): Result<FigmaResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyFigmaKindFiles({ at }),
    emptyManifest: initialFigmaManifest({ updatedAt: at }),
    paths,
    spec: FIGMA_STORE_SPEC,
  });
}
