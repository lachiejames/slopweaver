/** The Microsoft 365 integration's manifest — strings, its atlas row and `import()` thunks only. */
import { MICROSOFT365_ATLAS_REGISTRATION } from "../../atlas/microsoft365/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The microsoft365 row of the integration registry. */
export const MICROSOFT365_INTEGRATION = {
  features: {
    atlas: MICROSOFT365_ATLAS_REGISTRATION,
  },
  id: "microsoft365",
  name: "Microsoft 365",
} as const satisfies IntegrationManifest;
