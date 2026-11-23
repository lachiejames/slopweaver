/** The Google SecOps integration's manifest — strings, its atlas row and `import()` thunks only. */
import { GOOGLE_SECOPS_ATLAS_REGISTRATION } from "../../atlas/googleSecops/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The google-secops row of the integration registry. */
export const GOOGLE_SECOPS_INTEGRATION = {
  features: {
    atlas: GOOGLE_SECOPS_ATLAS_REGISTRATION,
    read: async () => (await import("../../live/googleSecops/transport.js")).buildSecopsUrl,
  },
  id: "google-secops",
  name: "Google SecOps",
} as const satisfies IntegrationManifest;
