/**
 * Canned Knock bodies and a plain fake read seam for the Knock door's tests — a function answering in request
 * order, never a mock. Every message, event and delivery log carries sentinel recipient, payload and body values,
 * so a test can assert none ever reaches a view or a printed line.
 */
import { err, ok, type Result } from "../../../../lib/result.js";
import { type KnockReadError, KnockReadErrors } from "../../../../live/knock/errors.js";
import type { KnockGet, KnockOperation } from "../../../../live/knock/transport.js";

/** A recipient id no view or line may ever contain. */
export const SENTINEL_RECIPIENT = "SENTINEL-CUSTOMER-USER-ID";

/** A payload value no view or line may ever contain. */
export const SENTINEL_PAYLOAD = "SENTINEL-PAYLOAD your results are ready";

/** A phone number no view or line may ever contain. */
export const SENTINEL_PHONE = "+61400000123";

/** A list item's opaque `__cursor`, which no view or line may ever contain. Its live type is undocumented. */
export const SENTINEL_CURSOR = "SENTINEL-CURSOR-g3QAAAABZAACaWQ";

/** A branching step's ref, which no view or line may ever contain. */
export const SENTINEL_BRANCH_STEP = "SENTINEL-BRANCH-STEP";

/**
 * One message as Knock answers it.
 *
 * @param id the message id
 * @param status Knock's delivery status
 * @returns the wire object
 */
export function wireMessage({ id, status }: { id: string; status: string }): Record<string, unknown> {
  return {
    __typename: "Message",
    actors: [SENTINEL_RECIPIENT],
    archived_at: null,
    channel: {
      created_at: "2026-01-01T00:00:00Z",
      id: "chan-sms",
      key: "twilio-sms",
      name: "Twilio SMS",
      provider: "twilio",
      type: "sms",
      updated_at: "2026-01-01T00:00:00Z",
    },
    channel_id: "chan-sms",
    clicked_at: null,
    data: { body: SENTINEL_PAYLOAD, phone: SENTINEL_PHONE },
    engagement_statuses: [],
    id,
    inserted_at: "2026-10-11T03:12:00.000000Z",
    interacted_at: null,
    link_clicked_at: null,
    metadata: { external_id: SENTINEL_PHONE },
    read_at: null,
    recipient: SENTINEL_RECIPIENT,
    recipient_snapshot: { email: null, name: SENTINEL_PAYLOAD, user_id: SENTINEL_RECIPIENT },
    scheduled_at: null,
    seen_at: null,
    source: {
      __typename: "MessageSource",
      branch_path: [
        { branch_id: "123e4567-e89b-12d3-a456-426614174000", step_ref: SENTINEL_BRANCH_STEP, step_type: "branch" },
      ],
      categories: [],
      key: "booking-reminder",
      step_ref: "sms_1",
      type: "workflow",
      version_id: "v-1",
      workflow_recipient_run_id: "wrr-1",
      workflow_run_id: "wr-1",
    },
    status,
    tenant: null,
    updated_at: "2026-10-11T03:12:09.000000Z",
    workflow: "booking-reminder",
  };
}

/**
 * One message as a Knock LIST answers it: the single-message shape plus the undocumented `__cursor` every live
 * list item carried.
 *
 * @param id the message id
 * @param status Knock's delivery status
 * @returns the wire object
 */
export function wireListMessage({ id, status }: { id: string; status: string }): Record<string, unknown> {
  return { ...wireMessage({ id, status }), __cursor: SENTINEL_CURSOR };
}

/**
 * One message event as Knock answers it.
 *
 * @param id the event id
 * @param type Knock's event type
 * @returns the wire object
 */
export function wireEvent({ id, type }: { id: string; type: string }): Record<string, unknown> {
  return {
    __typename: "MessageEvent",
    data: { body: SENTINEL_PAYLOAD },
    id,
    inserted_at: "2026-10-11T03:12:05.000000Z",
    recipient: SENTINEL_RECIPIENT,
    type,
  };
}

/**
 * One delivery log as Knock answers it.
 *
 * @param id the log id
 * @param status the provider's HTTP status, or `undefined` for none recorded
 * @returns the wire object
 */
export function wireDeliveryLog({ id, status }: { id: string; status: number | undefined }): Record<string, unknown> {
  const response: Record<string, unknown> = {
    body: { to: SENTINEL_PHONE },
    headers: { "x-sentinel": SENTINEL_PAYLOAD },
  };
  if (status !== undefined) {
    response["status"] = status;
  }
  return {
    __typename: "MessageDeliveryLog",
    environment_id: "env-1",
    id,
    inserted_at: "2026-10-11T03:12:02.000000Z",
    request: {
      body: { Body: SENTINEL_PAYLOAD, To: SENTINEL_PHONE },
      headers: { authorization: "Basic SENTINEL" },
      host: "api.twilio.com",
      method: "POST",
      path: "/2010-04-01/Accounts/AC/Messages.json",
      query: null,
    },
    response,
    service_name: "twilio",
  };
}

/**
 * One list page as Knock answers it.
 *
 * @param items the page's items
 * @param after the forward cursor, or null on the last page
 * @returns the body text
 */
export function listPage({ items, after }: { items: readonly unknown[]; after: string | null }): string {
  return JSON.stringify({
    items,
    page_info: { __typename: "PageInfo", after, before: null, page_size: 50, total_count: items.length },
  });
}

/**
 * One queued answer as the seam's result.
 *
 * @param operation the operation the GET was sent under
 * @param body the queued body, a failure, or `undefined` when the queue ran dry
 * @returns the result a GET answers
 */
function answer({
  operation,
  body,
}: {
  operation: KnockOperation;
  body: string | KnockReadError | undefined;
}): Result<string, KnockReadError> {
  if (body === undefined) {
    return err(KnockReadErrors.transportFailed({ operation, status: null }));
  }
  if (typeof body === "string") {
    return ok(body);
  }
  return err(body);
}

/**
 * A fake read seam answering each request from a queue of bodies, recording every request it was asked for.
 *
 * @param bodies the answers, in request order; a `KnockReadError` answers as a failed GET
 * @returns the seam and the requests it saw
 */
export function queuedGet({ bodies }: { bodies: readonly (string | KnockReadError)[] }): {
  get: KnockGet;
  seen: { operation: KnockOperation; url: URL }[];
} {
  const seen: { operation: KnockOperation; url: URL }[] = [];
  const get: KnockGet = ({ operation, url }) =>
    Promise.resolve(answer({ body: bodies[seen.push({ operation, url }) - 1], operation }));
  return { get, seen };
}
