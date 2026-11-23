/**
 * What each path the Knock door calls is allowed to answer — one strict boundary per endpoint.
 *
 * Pinned to the document this door was reviewed against, independently of the Knock surface-map atlas's own pin
 * (`src/atlas/knock/generated/specLock.ts`, left untouched): `https://api.knock.app/v1/openapi`,
 * 311,723 bytes, SHA-256 `ba7f46fe579e206e0a9930439f0c9fa9717989e54de85487a668f3a4367d6b16`.
 * Reproduce with `curl -s https://api.knock.app/v1/openapi | shasum -a 256` — a different digest means Knock
 * moved the document, and these key sets are re-read against it before trusting a refusal. The move from the
 * previous pin (310,772 bytes) added one key this door reads, `Message.source.branch_path`; `Message`,
 * `MessageChannel`, `PageInfo`, `MessageEvent` and `MessageDeliveryLog` with its request and response were re-read
 * against the new document and are otherwise unchanged.
 *
 * Every declared key is declared here, because a strict object refuses a key it was not told about and that
 * refusal is the point: a field Knock adds, renames or retypes fails the read with the field named instead of
 * reading as success. A key the projection never keeps is `unread`, so the key set stays known without the value
 * being trusted. `recipient`, `actors`, `data`, `metadata`, the recipient snapshot and every delivery-log
 * request and response body and header are person-linkable or message content: `projection.ts` has no path from
 * any of them to an output.
 *
 * R(equired) keys carry no `.optional()`; the rest do, and a key the document marks nullable carries
 * `.nullable()`. Formats (date-time, UUID) are plain strings, as the repository's boundary walker requires.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the projection never keeps. */
const unread = z.unknown().optional();

/** An optional, nullable string. */
const text = z.string().nullable().optional();

/**
 * `PageInfo`, on every list response. `total_count` is the one key the pinned document does not declare: the live
 * `GET /v1/messages` answered it while the document's digest was still the pinned one, so Knock's API
 * is ahead of its own spec. Typed as the document's only other `total_count` (the feed's `meta`, an integer) and
 * optional, because the document still promises no list carries it. Reproduce with `slopweaver knock verify`.
 */
const pageInfo = z.strictObject({
  __typename: z.string(),
  after: text,
  before: text,
  page_size: z.number().int(),
  total_count: z.number().int().nullable().optional(),
});

/** `RecipientReference`: a user id, or an object reference. Declared so drift is visible; never projected. */
const recipientReference = z.union([
  z.string(),
  z.strictObject({ collection: z.string().optional(), id: z.string().optional() }),
]);

/**
 * One segment of `MessageSource.branch_path`: the branching step and the branch it took. Typed, though never
 * projected, so a segment Knock reshapes fails the read with the key named, as the channel and snapshot do.
 */
const branchPathSegment = z.strictObject({ branch_id: z.string(), step_ref: z.string(), step_type: z.string() });

/**
 * `MessageSource`. `branch_path` is the branch ancestry of the step that sent the message, outermost first, and is
 * omitted when the step sits under no branch — first declared by the current document, and answered live.
 */
const messageSource = z.strictObject({
  __typename: z.string(),
  branch_path: z.array(branchPathSegment).nullable().optional(),
  categories: z.array(z.string()),
  key: z.string(),
  step_ref: text,
  type: z.enum(["broadcast", "workflow", "guide"]).optional(),
  version_id: z.string(),
  workflow_recipient_run_id: text,
  workflow_run_id: text,
});

/** `MessageChannel`. */
const messageChannel = z.strictObject({
  created_at: z.string(),
  id: z.string(),
  key: text,
  name: text,
  provider: z.string(),
  type: z.enum(["email", "in_app", "in_app_feed", "in_app_guide", "sms", "push", "chat", "http"]),
  updated_at: z.string(),
});

/** `RecipientSnapshot` — every child optional and nullable; never projected. */
const recipientSnapshot = z
  .strictObject({
    channel_id: unread,
    email: unread,
    name: unread,
    user_id: unread,
    via_incoming_webhook: unread,
  })
  .nullable()
  .optional();

/** `Message`, every key the pinned document declares. */
const messageWire = z.strictObject({
  __typename: z.string(),
  actors: z.array(recipientReference).optional(),
  archived_at: unread,
  channel: messageChannel.optional(),
  channel_id: z.string(),
  clicked_at: unread,
  data: unread,
  engagement_statuses: z.array(z.enum(["seen", "read", "interacted", "link_clicked", "archived"])),
  id: z.string(),
  inserted_at: z.string(),
  interacted_at: unread,
  link_clicked_at: unread,
  metadata: unread,
  read_at: unread,
  recipient: recipientReference,
  recipient_snapshot: recipientSnapshot,
  scheduled_at: text,
  seen_at: unread,
  source: messageSource,
  status: z.enum(["queued", "sent", "delivered", "delivery_attempted", "undelivered", "not_sent", "bounced"]),
  tenant: unread,
  updated_at: z.string(),
  workflow: unread,
});

/** One message as Knock answers it, parsed — internal to this door; the CLI only ever sees a projection. */
export type KnockMessageWire = z.output<typeof messageWire>;

/**
 * A `Message` as a LIST answers it, carrying the one key the pinned document does not declare: `__cursor`. The live
 * `GET /v1/messages` answered it on every item against the pinned digest, the way
 * `page_info.total_count` arrived. Undocumented, so its type is unknown and its value is `unread`, and it is
 * accepted on list items only — no single-message read has been seen to carry it, so `GET_KNOCK_MESSAGE` still
 * refuses it. The user list shares `ListMessagesResponse` in the document, which is why it takes the same shape.
 * Reproduce with `slopweaver knock verify`, which reads the first message a list returns.
 */
const listMessageWire = messageWire.extend({ __cursor: unread });

/** `ListMessagesResponse`. */
const listMessages = z.strictObject({ items: z.array(listMessageWire), page_info: pageInfo });

/** `MessageEvent`. */
const messageEvent = z.strictObject({
  __typename: z.string(),
  data: unread,
  id: z.string(),
  inserted_at: z.string(),
  recipient: recipientReference,
  type: z.enum([
    "message.created",
    "message.queued",
    "message.sent",
    "message.not_sent",
    "message.delivered",
    "message.delivery_attempted",
    "message.undelivered",
    "message.bounced",
    "message.complaint",
    "message.read",
    "message.unread",
    "message.seen",
    "message.unseen",
    "message.archived",
    "message.unarchived",
    "message.interacted",
    "message.link_clicked",
  ]),
});

/** One message event, parsed. */
export type KnockMessageEventWire = z.output<typeof messageEvent>;

/** `MessageDeliveryLog` — the provider call Knock made; only its service and response status are ever kept. */
const deliveryLog = z.strictObject({
  __typename: z.string(),
  environment_id: unread,
  id: z.string(),
  inserted_at: z.string(),
  request: z.strictObject({
    body: unread,
    headers: unread,
    host: unread,
    method: unread,
    path: unread,
    query: unread,
  }),
  response: z.strictObject({
    body: unread,
    headers: unread,
    status: z.number().int().optional(),
  }),
  service_name: z.string(),
});

/** One delivery log, parsed. */
export type KnockDeliveryLogWire = z.output<typeof deliveryLog>;

/** `GET /v1/messages`. */
export const LIST_KNOCK_MESSAGES = defineBoundary({ endpoint: "GET /v1/messages", schema: listMessages });

/** `GET /v1/users/{user_id}/messages` — the same response, its own named boundary. */
export const LIST_KNOCK_USER_MESSAGES = defineBoundary({
  endpoint: "GET /v1/users/{user_id}/messages",
  schema: listMessages,
});

/** `GET /v1/messages/{message_id}`. */
export const GET_KNOCK_MESSAGE = defineBoundary({ endpoint: "GET /v1/messages/{message_id}", schema: messageWire });

/** `GET /v1/messages/{message_id}/events`. */
export const LIST_KNOCK_MESSAGE_EVENTS = defineBoundary({
  endpoint: "GET /v1/messages/{message_id}/events",
  schema: z.strictObject({ items: z.array(messageEvent), page_info: pageInfo }),
});

/** `GET /v1/messages/{message_id}/delivery_logs`. */
export const LIST_KNOCK_DELIVERY_LOGS = defineBoundary({
  endpoint: "GET /v1/messages/{message_id}/delivery_logs",
  schema: z.strictObject({ items: z.array(deliveryLog), page_info: pageInfo }),
});
