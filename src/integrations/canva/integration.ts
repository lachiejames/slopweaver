/** The Canva integration's manifest — strings, its atlas row and `import()` thunks only. */
import { CANVA_ATLAS_REGISTRATION } from "../../atlas/canva/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The canva row of the integration registry. */
export const CANVA_INTEGRATION = {
  features: {
    atlas: CANVA_ATLAS_REGISTRATION,
  },
  id: "canva",
  name: "Canva",
} as const satisfies IntegrationManifest;
