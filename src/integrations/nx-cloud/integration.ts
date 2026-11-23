/** The Nx Cloud integration's manifest — strings, its atlas row and `import()` thunks only. */
import { NX_CLOUD_ATLAS_REGISTRATION } from "../../atlas/nxCloud/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The nx-cloud row of the integration registry. */
export const NX_CLOUD_INTEGRATION = {
  features: {
    atlas: NX_CLOUD_ATLAS_REGISTRATION,
  },
  id: "nx-cloud",
  name: "Nx Cloud",
} as const satisfies IntegrationManifest;
