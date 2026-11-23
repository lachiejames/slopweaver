/** The Aether integration's manifest — strings, its atlas row and `import()` thunks only. */
import { AETHER_ATLAS_REGISTRATION } from "../../atlas/aether/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The aether row of the integration registry. */
export const AETHER_INTEGRATION = {
  features: {
    atlas: AETHER_ATLAS_REGISTRATION,
  },
  id: "aether",
  name: "Aether",
} as const satisfies IntegrationManifest;
