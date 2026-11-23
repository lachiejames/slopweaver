/** The Jam integration's manifest — strings, its atlas row and `import()` thunks only. */
import { JAM_ATLAS_REGISTRATION } from "../../atlas/jam/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The jam row of the integration registry. */
export const JAM_INTEGRATION = {
  features: {
    atlas: JAM_ATLAS_REGISTRATION,
  },
  id: "jam",
  name: "Jam",
} as const satisfies IntegrationManifest;
