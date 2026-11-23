/**
 * `atlas xero reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Xero's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is complete
 * rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/xero/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyXeroKindFile, initialXeroManifest, type XeroAtlasKind, type XeroAtlasKindFile } from "./model.js";
import { XERO_STORE_SPEC, type XeroAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type XeroResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyXeroFiles({ at }: { at: string }): Readonly<Record<XeroAtlasKind, XeroAtlasKindFile>> {
  return {
    family: emptyXeroKindFile({ kind: "family", updatedAt: at }),
    method: emptyXeroKindFile({ kind: "method", updatedAt: at }),
    page: emptyXeroKindFile({ kind: "page", updatedAt: at }),
  };
}

/**
 * Archive the current Xero atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetXeroAtlas({ paths, at }: { paths: XeroAtlasPaths; at: string }): Result<XeroResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyXeroFiles({ at }),
    emptyManifest: initialXeroManifest({ updatedAt: at }),
    paths,
    spec: XERO_STORE_SPEC,
  });
}
