/** The Make integration's manifest — strings, its atlas row and `import()` thunks only. */
import { MAKE_ATLAS_REGISTRATION } from "../../atlas/make/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The make row of the integration registry. */
export const MAKE_INTEGRATION = {
  features: {
    atlas: MAKE_ATLAS_REGISTRATION,
  },
  id: "make",
  name: "Make",
} as const satisfies IntegrationManifest;
