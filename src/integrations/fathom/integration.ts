/** The Fathom integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The fathom row of the integration registry. */
export const FATHOM_INTEGRATION = {
  connection: {
    connectWith: "slopweaver secrets set fathom-api-key",
    credentialSets: [["fathom-api-key"]],
    ordinal: 4,
  },
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 8,
    progressPhase: false,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: {
    ingest: async () => (await import("../../corpus/fathom/ingest.js")).readCap,
    read: async () => (await import("../../live/fathom/api.js")).FATHOM_PAGE_SIZE,
  },
  id: "fathom",
  name: "Fathom",
  noun: {
    kind: "not-a-source",
    reason: "reads a shared call into bronze, like `refresh`; the transcripts it writes are the `corpus` row",
  },
} as const satisfies IntegrationManifest;
