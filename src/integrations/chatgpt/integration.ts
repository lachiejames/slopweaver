/** The ChatGPT integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The chatgpt row of the integration registry. */
export const CHATGPT_INTEGRATION = {
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 9,
    progressPhase: false,
    resyncDemand: false,
    upfrontTokenGate: false,
  },
  features: {
    ingest: async () => (await import("../../corpus/chatgpt/ingest.js")).chatgptIngestJob,
  },
  id: "chatgpt",
  name: "ChatGPT",
  noun: {
    kind: "not-a-source",
    reason:
      "imports the owner's history export into bronze, like `refresh`, and lists the account and reads a named chat live; the history is the `corpus` row",
  },
} as const satisfies IntegrationManifest;
