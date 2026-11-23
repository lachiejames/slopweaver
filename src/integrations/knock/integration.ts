/** The Knock integration's manifest — strings, its atlas row and `import()` thunks only. */
import { KNOCK_ATLAS_REGISTRATION } from "../../atlas/knock/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The knock row of the integration registry. */
export const KNOCK_INTEGRATION = {
  features: {
    atlas: KNOCK_ATLAS_REGISTRATION,
    read: async () => (await import("../../live/knock/reads.js")).verifyKnockAccess,
  },
  id: "knock",
  name: "Knock",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "knock", "verify"],
        coverage: {
          detail:
            "whether this install's Knock key reads messages. The READING is the separate act: `slopweaver knock " +
            "user-messages --user-id <id>` lists what Knock sent one user, `knock messages --status undelivered` " +
            "narrows the environment, and `knock message-events --id <id>` and `knock delivery-logs --id <id>` show " +
            "what became of one and what its provider answered. Delivery facts only — never a recipient, payload or " +
            "body, stored nowhere",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Knock when the planned command runs", kind: "live" },
        id: "knock",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["knock", "noc", "notification", "notifications", "workflow", "delivery log", "message events"],
        truthMode: "current",
        what: "which notifications Knock sent a user and what became of each — status, event trail and the provider's answer, read live from Knock",
      },
      ordinal: 22,
    },
  ],
} as const satisfies IntegrationManifest;
