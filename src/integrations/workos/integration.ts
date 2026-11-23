/** The WorkOS integration's manifest — strings, its atlas row and `import()` thunks only. */
import { WORKOS_ATLAS_REGISTRATION } from "../../atlas/workos/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The workos row of the integration registry. */
export const WORKOS_INTEGRATION = {
  features: {
    atlas: WORKOS_ATLAS_REGISTRATION,
  },
  id: "workos",
  name: "WorkOS",
} as const satisfies IntegrationManifest;
