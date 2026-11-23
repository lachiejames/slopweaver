/** The Google Admin integration's manifest — strings, its atlas row and `import()` thunks only. */
import { GOOGLE_ADMIN_ATLAS_REGISTRATION } from "../../atlas/googleAdmin/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The google-admin row of the integration registry. */
export const GOOGLE_ADMIN_INTEGRATION = {
  features: {
    atlas: GOOGLE_ADMIN_ATLAS_REGISTRATION,
    read: async () => (await import("../../live/googleAdmin/read.js")).MAX_FILL_PAGES,
  },
  id: "google-admin",
  name: "Google Admin",
} as const satisfies IntegrationManifest;
