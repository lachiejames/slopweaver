/**
 * Archive the whole current Linear generation and install a fresh, empty one. Nothing is ever deleted.
 *
 * The protocol is `kit/reset.ts`'s. What is Linear's is the empty generation it installs: four kind files
 * and a manifest whose `workspaceId` is `null`, so the workspace publish guard has nothing to compare
 * against on the next sync — which is exactly right, since re-pointing this atlas at a different workspace
 * is one of the two reasons to reset it.
 */

import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";
import {
  emptyLinearAtlasKindFile,
  initialLinearAtlasManifest,
  type LinearAtlasKind,
  type LinearAtlasKindFile,
} from "./model.js";
import { LINEAR_ATLAS_STORE_SPEC, type LinearAtlasPaths } from "./store.js";

/**
 * Archive the current generation and install a fresh, empty one.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetLinearAtlas({ paths, at }: { paths: LinearAtlasPaths; at: string }): Result<AtlasResetOutcome> {
  const emptyFiles = {
    operation: emptyLinearAtlasKindFile({ kind: "operation", updatedAt: at }),
    page: emptyLinearAtlasKindFile({ kind: "page", updatedAt: at }),
    setting: emptyLinearAtlasKindFile({ kind: "setting", updatedAt: at }),
    type: emptyLinearAtlasKindFile({ kind: "type", updatedAt: at }),
  } satisfies Record<LinearAtlasKind, LinearAtlasKindFile>;
  return resetAtlas({
    at,
    emptyFiles,
    emptyManifest: initialLinearAtlasManifest({ updatedAt: at }),
    paths,
    spec: LINEAR_ATLAS_STORE_SPEC,
  });
}
