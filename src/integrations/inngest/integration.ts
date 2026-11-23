/** The Inngest integration's manifest — strings, its atlas row and `import()` thunks only. */
import { INNGEST_ATLAS_REGISTRATION } from "../../atlas/inngest/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The inngest row of the integration registry. */
export const INNGEST_INTEGRATION = {
  features: {
    atlas: INNGEST_ATLAS_REGISTRATION,
  },
  id: "inngest",
  name: "Inngest",
} as const satisfies IntegrationManifest;
