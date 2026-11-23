/** The Braze integration's manifest — strings, its atlas row and `import()` thunks only. */
import { BRAZE_ATLAS_REGISTRATION } from "../../atlas/braze/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The braze row of the integration registry. */
export const BRAZE_INTEGRATION = {
  features: {
    atlas: BRAZE_ATLAS_REGISTRATION,
  },
  id: "braze",
  name: "Braze",
} as const satisfies IntegrationManifest;
