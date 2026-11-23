/**
 * The Events API's answer, read through a strict boundary — every key `POST /api/v2/auditevents` sends is
 * declared, so a key 1Password adds, drops or renames refuses the walk by NAME instead of reading as absence or
 * riding along unseen.
 *
 * Two layers, deliberately separate. This one detects drift: the page envelope and every audit item are
 * `z.strictObject`s, the keys the atlas reads typed and the rest `z.unknown().optional()`. The storage allowlist
 * is still `model.ts`'s `onepasswordEventDetailSchema`, run by `projection.ts` after this read — so a field this
 * boundary declares but never reads (`object_details`, `location.latitude`) is held in memory for one page and
 * never reaches a document.
 *
 * A refusal names a key and never a value: the boundary's drift message is built from paths and Zod's own
 * expected-type wording, so nothing here can quote an event back.
 */
import { z } from "zod";

import { type BoundaryError, defineBoundary } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";

const unread = z.unknown().optional();

const optionalText = z.string().nullable().optional();

const sessionWire = z.strictObject({
  device_uuid: optionalText,
  ip: optionalText,
  login_time: optionalText,
  uuid: optionalText,
});

const locationWire = z.strictObject({
  city: optionalText,
  country: optionalText,
  latitude: unread,
  longitude: unread,
  region: optionalText,
});

const auditEventWire = z.strictObject({
  account_uuid: unread,
  action: z.string().min(1),
  actor_details: unread,
  actor_type: optionalText,
  actor_uuid: optionalText,
  aux_details: unread,
  aux_id: unread,
  aux_info: unread,
  aux_uuid: unread,
  location: locationWire.nullable().optional(),
  object_details: unread,
  object_type: optionalText,
  object_uuid: optionalText,
  session: sessionWire.nullable().optional(),
  timestamp: z.string().min(1),
  uuid: z.string().min(1),
});

const AUDIT_PAGE = defineBoundary({
  endpoint: "POST /api/v2/auditevents",
  schema: z.strictObject({
    cursor: z.string().min(1),
    has_more: z.boolean(),
    items: z.array(auditEventWire),
  }),
});

/** One audit event as the wire carries it, every key declared. */
export type OnepasswordAuditEventWire = z.output<typeof auditEventWire>;

/** One page of the audit feed, read. */
export interface OnepasswordAuditPage {
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly items: readonly OnepasswordAuditEventWire[];
}

/**
 * Read one `auditevents` page through its strict boundary. All three envelope keys are required: a page with no
 * cursor or no `has_more` is drift, never "the walk is over".
 *
 * @param text the response body as sent
 * @returns the page, or the boundary's refusal naming the key that drifted
 */
export function readOnepasswordAuditPage({ text }: { text: string }): Result<OnepasswordAuditPage, BoundaryError> {
  return AUDIT_PAGE.parseJson({ text }).map((page) => ({
    cursor: page.cursor,
    hasMore: page.has_more,
    items: page.items,
  }));
}
