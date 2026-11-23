/** The Twilio integration's manifest — strings, its atlas row and `import()` thunks only. */
import { TWILIO_ATLAS_REGISTRATION } from "../../atlas/twilio/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The twilio row of the integration registry. */
export const TWILIO_INTEGRATION = {
  features: {
    atlas: TWILIO_ATLAS_REGISTRATION,
    read: async () => (await import("../../live/twilio/reads.js")).TWILIO_MAX_PAGES,
  },
  id: "twilio",
  name: "Twilio",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "twilio", "verify"],
        coverage: {
          detail:
            "whether this install's Twilio key reads Messages. The READING is the separate act: `slopweaver twilio " +
            "messages --to <+E.164> --sent-after <day> --sent-before <day>` lists what was sent to a number in a " +
            "window with each message's status and Twilio error code, and `twilio message --sid <SM…>` re-reads one " +
            "live. Delivery facts only — never a body, numbers masked, stored nowhere",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Twilio when the planned command runs", kind: "live" },
        id: "twilio",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["twilio", "sms", "text message", "delivered", "undelivered", "delivery receipt", "30003", "30005"],
        truthMode: "current",
        what: "whether an SMS reached a number — each message's delivery status, carrier error code and send time, read live from Twilio",
      },
      ordinal: 21,
    },
  ],
} as const satisfies IntegrationManifest;
