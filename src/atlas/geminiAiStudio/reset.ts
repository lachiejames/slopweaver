/**
 * `atlas gemini-ai-studio reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under
 * `$SLOPWEAVER_HOME/atlas/_superseded/gemini-ai-studio/`.
 *
 * The cached discovery documents are NOT archived with it. Each is named by the digest of its own bytes, so
 * a later generation built from the same documents finds them exactly where they were, and re-downloading
 * them to rebuild a generation that would be byte-identical is a cost with nothing on the other side of it.
 */
import type { Result } from "../../lib/result.js";
import { recordPerKind } from "../kit/kindRecord.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import {
  emptyGeminiAiStudioKindFile,
  GEMINI_AI_STUDIO_KINDS,
  type GeminiAiStudioAtlasKindFile,
  type GeminiAiStudioKind,
  initialGeminiAiStudioManifest,
} from "./model.js";
import { GEMINI_AI_STUDIO_STORE_SPEC, type GeminiAiStudioAtlasPaths } from "./store.js";

/**
 * What a reset did.
 *
 * @internal
 */
export type GeminiAiStudioResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyGeminiAiStudioFiles({
  at,
}: {
  at: string;
}): Readonly<Record<GeminiAiStudioKind, GeminiAiStudioAtlasKindFile>> {
  return recordPerKind({
    kinds: GEMINI_AI_STUDIO_KINDS,
    valueFor: ({ kind }) => emptyGeminiAiStudioKindFile({ kind, updatedAt: at }),
  });
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetGeminiAiStudioAtlas({
  paths,
  at,
}: {
  paths: GeminiAiStudioAtlasPaths;
  at: string;
}): Result<GeminiAiStudioResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyGeminiAiStudioFiles({ at }),
    emptyManifest: initialGeminiAiStudioManifest({ updatedAt: at }),
    paths,
    spec: GEMINI_AI_STUDIO_STORE_SPEC,
  });
}
