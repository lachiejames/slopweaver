/** The Trelica integration's manifest — strings, its atlas row and `import()` thunks only. */
import { TRELICA_ATLAS_REGISTRATION } from "../../atlas/trelica/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The trelica row of the integration registry. */
export const TRELICA_INTEGRATION = {
  connection: {
    connectWith: "slopweaver secrets set trelica-tenant-host",
    credentialSets: [["trelica-tenant-host"]],
    ordinal: 11,
  },
  features: {
    atlas: TRELICA_ATLAS_REGISTRATION,
  },
  id: "trelica",
  name: "Trelica",
} as const satisfies IntegrationManifest;
