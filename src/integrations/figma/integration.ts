/** The Figma integration's manifest — strings, its atlas row and `import()` thunks only. */
import { FIGMA_ATLAS_REGISTRATION } from "../../atlas/figma/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The figma row of the integration registry. */
export const FIGMA_INTEGRATION = {
  features: {
    atlas: FIGMA_ATLAS_REGISTRATION,
  },
  id: "figma",
  name: "Figma",
} as const satisfies IntegrationManifest;
