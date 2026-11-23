/** The Nightfall integration's manifest — strings, its atlas row and `import()` thunks only. */
import { NIGHTFALL_ATLAS_REGISTRATION } from "../../atlas/nightfall/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The nightfall row of the integration registry. */
export const NIGHTFALL_INTEGRATION = {
  features: {
    atlas: NIGHTFALL_ATLAS_REGISTRATION,
  },
  id: "nightfall",
  name: "Nightfall",
} as const satisfies IntegrationManifest;
