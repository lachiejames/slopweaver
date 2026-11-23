/**
 * `slopweaver atlas gemini-ai-studio reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is this atlas's own is where its paths resolve and what an
 * empty generation looks like. The cached discovery documents are left where they are, each named by the
 * digest of its own bytes, so a rebuild costs no download.
 */
import { resetGeminiAiStudioAtlas } from "../../../atlas/geminiAiStudio/reset.js";
import { geminiAiStudioAtlasPaths } from "../../../atlas/geminiAiStudio/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_RESET_USAGE =
  "usage: slopweaver atlas gemini-ai-studio reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive this atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function geminiAiStudioAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "gemini-ai-studio",
    reset: ({ home, at }) => resetGeminiAiStudioAtlas({ at, paths: geminiAiStudioAtlasPaths({ home }) }),
    usage: GEMINI_AI_STUDIO_RESET_USAGE,
  });
}
