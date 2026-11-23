/**
 * What each path the Twilio door calls is allowed to answer — one strict boundary per endpoint.
 *
 * The key sets are Twilio's own: `api.v2010.account.message` and the inline `ListMessageResponse` in
 * `twilio_api_v2010.json` at the tag the Twilio atlas pins (`src/atlas/twilio/generated/specLock.ts`, `2.8.1`).
 * Reproduce the field list with `slopweaver atlas twilio read --kind method --query "Messages.json"`.
 *
 * Every declared key is declared here, because a strict object refuses a key it was not told about and that
 * refusal is the point: a field Twilio adds, renames or retypes fails the read with the field named instead of
 * reading as success. A key the projection never keeps is `unread`, so the key set stays known without the
 * value being trusted.
 *
 * **`body` is declared and never read.** An SMS body is message content, and the door's whole posture is
 * that it reports DELIVERY — status, error code, when — and never what was said. `projection.ts` has no path
 * from this field to any output.
 *
 * The pinned schema has no `required` list and types every property nullable. The two this door cannot answer
 * without — a message's `sid` and `status`, and a page's `messages` — are required here, so an answer missing
 * one fails loudly as "field is missing" rather than projecting a row that says nothing.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the projection never keeps. */
const unread = z.unknown().optional();

/** A nullable string, as the pinned schema types almost every field. */
const text = z.string().nullable().optional();

/** `api.v2010.account.message`, every key the pinned schema declares. */
const messageWire = z.strictObject({
  account_sid: text,
  api_version: unread,
  body: unread,
  date_created: text,
  date_sent: text,
  date_updated: text,
  direction: text,
  error_code: z.number().int().nullable().optional(),
  error_message: text,
  from: text,
  messaging_service_sid: text,
  num_media: text,
  num_segments: text,
  price: unread,
  price_unit: unread,
  sid: z.string(),
  status: z.string(),
  subresource_uris: unread,
  to: text,
  uri: unread,
});

/** One message as Twilio answers it, parsed — internal to this door; the CLI only ever sees a projection. */
export type TwilioMessageWire = z.output<typeof messageWire>;

/** `GET /2010-04-01/Accounts/{AccountSid}/Messages/{Sid}.json`. */
export const GET_TWILIO_MESSAGE = defineBoundary({
  endpoint: "GET /2010-04-01/Accounts/{AccountSid}/Messages/{Sid}.json",
  schema: messageWire,
});

/** `GET /2010-04-01/Accounts/{AccountSid}/Messages.json` — the inline `ListMessageResponse`. */
export const LIST_TWILIO_MESSAGES = defineBoundary({
  endpoint: "GET /2010-04-01/Accounts/{AccountSid}/Messages.json",
  schema: z.strictObject({
    end: unread,
    first_page_uri: unread,
    messages: z.array(messageWire),
    next_page_uri: text,
    page: unread,
    page_size: unread,
    previous_page_uri: unread,
    start: unread,
    uri: unread,
  }),
});
