/** The Gemini AI Studio integration's manifest — strings, its atlas row and `import()` thunks only. */
import { GEMINI_AI_STUDIO_ATLAS_REGISTRATION } from "../../atlas/geminiAiStudio/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The gemini-ai-studio row of the integration registry. */
export const GEMINI_AI_STUDIO_INTEGRATION = {
  features: {
    atlas: GEMINI_AI_STUDIO_ATLAS_REGISTRATION,
  },
  id: "gemini-ai-studio",
  name: "Gemini AI Studio",
} as const satisfies IntegrationManifest;
