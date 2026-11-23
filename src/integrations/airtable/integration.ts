/** The Airtable integration's manifest — strings, its atlas row and `import()` thunks only. */
import { AIRTABLE_ATLAS_REGISTRATION } from "../../atlas/airtable/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The airtable row of the integration registry. */
export const AIRTABLE_INTEGRATION = {
  features: {
    atlas: AIRTABLE_ATLAS_REGISTRATION,
  },
  id: "airtable",
  name: "Airtable",
} as const satisfies IntegrationManifest;
