/** The CrowdStrike integration's manifest — strings, its atlas row and `import()` thunks only. */
import { CROWDSTRIKE_ATLAS_REGISTRATION } from "../../atlas/crowdstrike/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The crowdstrike row of the integration registry. */
export const CROWDSTRIKE_INTEGRATION = {
  features: {
    atlas: CROWDSTRIKE_ATLAS_REGISTRATION,
  },
  id: "crowdstrike",
  name: "CrowdStrike",
  noun: { kind: "not-a-source", reason: "syncs the crowdstrike atlas; `atlas crowdstrike` is the read" },
} as const satisfies IntegrationManifest;
