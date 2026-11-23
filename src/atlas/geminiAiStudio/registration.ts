/**
 * The Gemini / Google AI Studio atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` compiles
 * Google's three published discovery documents into the atlas's only filled surface, and `reset` archives a
 * generation.
 *
 * There is deliberately no `walk` yet. The browser surface is declared and unfilled, and a verb that could
 * not fill it would be a promise rather than a capability — `browserPages.ts` is the declaration, and the
 * descriptor says what it would take.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The gemini-ai-studio row of the registry. */
export const GEMINI_AI_STUDIO_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` may fetch three public, unauthenticated discovery documents when they are not already cached,
    // and writes only under $SLOPWEAVER_HOME. No Google credential, no project reached, no door.
    doorRouted: false,
    example: "slopweaver atlas gemini-ai-studio read --kind models --json",
    summary:
      "The Gemini / Google AI Studio atlas — a SURFACE MAP: every operation the three published Gemini " +
      "discovery documents declare with its parameters and response fields, where the versions disagree, " +
      "and the AI Studio and Gemini app pages it declares and has not yet walked. It holds NO entity of " +
      "this organisation's by ruling — those are the Google Admin atlas's, named on a held-elsewhere cell",
    kitDescriptions: {
      coverage: "what this atlas knows it does NOT know — including who holds its entities instead",
      read: "the stored operations, filtered by kind, surface, id or query",
    },
  },
  platform: "gemini-ai-studio",
  readDescriptor: async () => (await import("./descriptor.js")).GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readGeminiAiStudioSnapshot(args),
  verbs: [
    {
      describe: "compile the three published Gemini discovery documents; no credential, no project reached",
      load: async () =>
        (await import("../../cli/commands/geminiAiStudioAtlas/syncRun.js")).geminiAiStudioAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () =>
        (await import("../../cli/commands/geminiAiStudioAtlas/resetRun.js")).geminiAiStudioAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
