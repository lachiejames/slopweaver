/**
 * `atlas notion reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Notion's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is complete
 * rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/notion/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyNotionKindFile, initialNotionManifest, type NotionAtlasKind, type NotionAtlasKindFile } from "./model.js";
import { NOTION_STORE_SPEC, type NotionAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type NotionResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyNotionFiles({ at }: { at: string }): Readonly<Record<NotionAtlasKind, NotionAtlasKindFile>> {
  return {
    method: emptyNotionKindFile({ kind: "method", updatedAt: at }),
    page: emptyNotionKindFile({ kind: "page", updatedAt: at }),
  };
}

/**
 * Archive the current Notion atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetNotionAtlas({ paths, at }: { paths: NotionAtlasPaths; at: string }): Result<NotionResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyNotionFiles({ at }),
    emptyManifest: initialNotionManifest({ updatedAt: at }),
    paths,
    spec: NOTION_STORE_SPEC,
  });
}
