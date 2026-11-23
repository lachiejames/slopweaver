/** The Clerk integration's manifest — strings, its atlas row and `import()` thunks only. */
import { CLERK_ATLAS_REGISTRATION } from "../../atlas/clerk/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The clerk row of the integration registry. */
export const CLERK_INTEGRATION = {
  features: {
    atlas: CLERK_ATLAS_REGISTRATION,
  },
  id: "clerk",
  name: "Clerk",
} as const satisfies IntegrationManifest;
