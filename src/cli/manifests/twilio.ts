/**
 * Lazy manifest for the `twilio` noun — the READ door over Twilio's Messages resource (`src/live/twilio/**`), a
 * peer of `src/hex/**` rather than a tenant of the Twilio surface-map atlas.
 *
 * Read-only doors for investigations, SMS delivery records first. The atlas
 * maps what Twilio offers and withholds every message row; these verbs read the account live, print delivery
 * facts to the session that asked, and store nothing.
 *
 * Every verb is `effect: "external-read"` and therefore not `doorRouted`, exactly as every `hex` verb is
 * classified. Nothing here can write to Twilio: the transport's method type admits `GET` alone and its URL check
 * admits two message paths, so a send is not expressible rather than merely unused.
 */
import { TWILIO_MESSAGE_USAGE, TWILIO_MESSAGES_USAGE, TWILIO_VERIFY_USAGE } from "../commands/twilio/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every `twilio` verb shares this classification — see the file header. */
const READ_META = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  parseRejectIsIoFree: true,
} as const;

export const twilioManifest: Readonly<Record<string, VerbManifestEntry>> = {
  message: lazy({
    load: () => import("../commands/twilio/messageRun.js").then((m) => m.twilioMessageCommand),
    meta: {
      ...READ_META,
      example: "slopweaver twilio message --sid SM0123456789abcdef0123456789abcdef",
      summary:
        "One message's delivery facts re-read live — status, Twilio's error code, when it was sent — because a " +
        "status moves after the list was read. Never the body; numbers masked to their last three digits",
      usage: TWILIO_MESSAGE_USAGE,
    },
  }),
  messages: lazy({
    load: () => import("../commands/twilio/messagesRun.js").then((m) => m.twilioMessagesCommand),
    meta: {
      ...READ_META,
      example: "slopweaver twilio messages --to +61400000000 --sent-after 2026-10-11 --sent-before 2026-10-12",
      summary:
        "Which SMS went to or from a number in a window and whether each was delivered — the delivery proof an " +
        "investigation needs. Never a body; numbers masked; a limit cut short says so",
      usage: TWILIO_MESSAGES_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/twilio/verifyRun.js").then((m) => m.twilioVerifyCommand),
    meta: {
      ...READ_META,
      example: "slopweaver twilio verify",
      summary:
        "Whether the stored restricted key reads Messages on the stored account, fetching no message at all — " +
        "an empty page bounded before any message could exist",
      usage: TWILIO_VERIFY_USAGE,
    },
  }),
};
