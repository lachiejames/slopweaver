/**
 * Lazy manifest for the `knock` noun — the READ door over Knock's message, event and delivery-log endpoints
 * (`src/live/knock/**`), a peer of `src/live/twilio/**` rather than a tenant of the Knock surface-map atlas.
 *
 * Read-only doors for investigations ("NOC" on the call is Knock, the
 * notification layer that sends the SMS Twilio carries). These verbs read Knock live, print delivery facts to the
 * session that asked, and store nothing.
 *
 * Every verb is `effect: "external-read"` and therefore not `doorRouted`, exactly as every `hex` and `twilio` verb
 * is classified. Nothing here can write to Knock: the transport's method type admits `GET` alone and its URL check
 * admits five read routes, so a trigger or a status write is not expressible rather than merely unused.
 */
import {
  KNOCK_DELIVERY_LOGS_USAGE,
  KNOCK_MESSAGE_EVENTS_USAGE,
  KNOCK_MESSAGE_USAGE,
  KNOCK_MESSAGES_USAGE,
  KNOCK_USER_MESSAGES_USAGE,
  KNOCK_VERIFY_USAGE,
} from "../commands/knock/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every `knock` verb shares this classification — see the file header. */
const READ_META = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  parseRejectIsIoFree: true,
} as const;

export const knockManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "delivery-logs": lazy({
    load: () => import("../commands/knock/messageRun.js").then((m) => m.knockDeliveryLogsCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock delivery-logs --id 2FVHPWxRqNuXQ9krvNP5A6Z4qXe",
      summary:
        "The provider calls Knock made for one message — which service, and the HTTP status it answered — where " +
        '"Knock sent it" becomes "Twilio accepted it" or refused it. Never a request or response body',
      usage: KNOCK_DELIVERY_LOGS_USAGE,
    },
  }),
  message: lazy({
    load: () => import("../commands/knock/messageRun.js").then((m) => m.knockMessageCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock message --id 2FVHPWxRqNuXQ9krvNP5A6Z4qXe",
      summary:
        "One Knock message re-read live — status, channel, workflow and step, when it was inserted and last " +
        "updated. Never its recipient, payload or content",
      usage: KNOCK_MESSAGE_USAGE,
    },
  }),
  "message-events": lazy({
    load: () => import("../commands/knock/messageRun.js").then((m) => m.knockMessageEventsCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock message-events --id 2FVHPWxRqNuXQ9krvNP5A6Z4qXe",
      summary:
        "One message's event trail — queued, sent, delivered, undelivered, bounced — each with its time. The " +
        "events' data payloads are never read",
      usage: KNOCK_MESSAGE_EVENTS_USAGE,
    },
  }),
  messages: lazy({
    load: () => import("../commands/knock/messagesRun.js").then((m) => m.knockMessagesCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock messages --status undelivered --inserted-after 2026-10-11T00:00:00Z",
      summary:
        "The notifications Knock sent in this environment, narrowed by status, channel, workflow or window — " +
        "delivery facts only, a limit cut short says so",
      usage: KNOCK_MESSAGES_USAGE,
    },
  }),
  "user-messages": lazy({
    load: () => import("../commands/knock/messagesRun.js").then((m) => m.knockUserMessagesCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock user-messages --user-id user_0123 --inserted-after 2026-10-11T00:00:00Z",
      summary: "The notifications Knock sent ONE user, by the application's own user id. The id is sent, never printed",
      usage: KNOCK_USER_MESSAGES_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/knock/verifyRun.js").then((m) => m.knockVerifyCommand),
    meta: {
      ...READ_META,
      example: "slopweaver knock verify",
      summary:
        "Whether the stored Knock secret key reads messages, and whether the first message a list returns still " +
        "reads through the strict boundary, printing nothing of it — Knock mints no read-only key, so the GET-only " +
        "transport is what bounds this door",
      usage: KNOCK_VERIFY_USAGE,
    },
  }),
};
