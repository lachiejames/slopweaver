/** The KnowBe4 integration's manifest — strings, its atlas row and `import()` thunks only. */
import { KNOWBE4_ATLAS_REGISTRATION } from "../../atlas/knowbe4/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The knowbe4 row of the integration registry. */
export const KNOWBE4_INTEGRATION = {
  features: {
    atlas: KNOWBE4_ATLAS_REGISTRATION,
    read: async () => (await import("../../live/knowbe4/transport.js")).KNOWBE4_API_ORIGIN,
  },
  id: "knowbe4",
  name: "KnowBe4",
} as const satisfies IntegrationManifest;
