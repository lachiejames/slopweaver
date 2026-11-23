/** The Xero integration's manifest — strings, its atlas row and `import()` thunks only. */
import { XERO_ATLAS_REGISTRATION } from "../../atlas/xero/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The xero row of the integration registry. */
export const XERO_INTEGRATION = {
  features: {
    atlas: XERO_ATLAS_REGISTRATION,
  },
  id: "xero",
  name: "Xero",
} as const satisfies IntegrationManifest;
