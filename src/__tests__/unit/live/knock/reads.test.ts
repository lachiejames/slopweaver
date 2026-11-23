/**
 * The Knock reads over a plain fake seam: what each sends, how paging is bounded (the caller's limit says so, a
 * repeated cursor and the page ceiling refuse), a body the strict boundary will not read is a fault and never an
 * empty answer, and no recipient, payload or body ever reaches a view.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { KnockReadErrors } from "../../../../live/knock/errors.js";
import { KNOCK_MAX_PAGES } from "../../../../live/knock/paging.js";
import { renderKnockMessage } from "../../../../live/knock/projection.js";
import {
  type KnockMessageFilter,
  listKnockDeliveryLogs,
  listKnockMessageEvents,
  listKnockMessages,
  listKnockUserMessages,
  readKnockMessage,
  verifyKnockAccess,
} from "../../../../live/knock/reads.js";
import {
  listPage,
  queuedGet,
  SENTINEL_BRANCH_STEP,
  SENTINEL_CURSOR,
  SENTINEL_PAYLOAD,
  SENTINEL_PHONE,
  SENTINEL_RECIPIENT,
  wireDeliveryLog,
  wireEvent,
  wireListMessage,
  wireMessage,
} from "./knockFixtures.js";

/** No filter at all. */
const NO_FILTER: KnockMessageFilter = {
  channelId: null,
  insertedAfter: null,
  insertedBefore: null,
  source: null,
  statuses: [],
  tenant: null,
  workflowRecipientRunId: null,
  workflowRunId: null,
};

describe("verifyKnockAccess", () => {
  /** The far-future page that proves the key. */
  const EMPTY = listPage({ after: null, items: [] });

  it("proves the key on a far-future page, then reads exactly one unfiltered page of one message", async () => {
    const { get, seen } = queuedGet({
      bodies: [EMPTY, listPage({ after: "c-2", items: [wireListMessage({ id: "m-1", status: "sent" })] })],
    });
    expect(unwrap(await verifyKnockAccess({ get }))).toEqual({ messageShape: "exercised" });
    expect(seen.map((request) => [request.operation, request.url.href])).toEqual([
      ["knock.messages.list", "https://api.knock.app/v1/messages?inserted_at.gte=2999-01-01T00%3A00%3A00Z&page_size=1"],
      ["knock.messages.list", "https://api.knock.app/v1/messages?page_size=1"],
    ]);
  });

  it("returns the verdict alone — nothing of the message it read, its id included", async () => {
    const { get } = queuedGet({
      bodies: [EMPTY, listPage({ after: null, items: [wireListMessage({ id: "m-sentinel", status: "sent" })] })],
    });
    expect(JSON.stringify(unwrap(await verifyKnockAccess({ get })))).toBe('{"messageShape":"exercised"}');
  });

  it("says no message shape was tested when the environment returned none", async () => {
    const { get } = queuedGet({ bodies: [EMPTY, EMPTY] });
    expect(unwrap(await verifyKnockAccess({ get }))).toEqual({ messageShape: "unexercised" });
  });

  it("refuses a returned message the strict boundary will not read, naming the endpoint and the field", async () => {
    const drifted = { ...wireListMessage({ id: "m-1", status: "sent" }), recipient_phone: SENTINEL_PHONE };
    const { get } = queuedGet({ bodies: [EMPTY, listPage({ after: null, items: [drifted] })] });
    const refused = unwrapErr(await verifyKnockAccess({ get }));
    expect(refused.code).toBe("RESPONSE_REFUSED");
    expect(refused.message).toContain("GET /v1/messages");
    expect(refused.message).toContain("recipient_phone");
  });

  it("passes a 401 through as the transport failure and sends no second read", async () => {
    const denied = KnockReadErrors.transportFailed({ operation: "knock.messages.list", status: 401 });
    const { get, seen } = queuedGet({ bodies: [denied] });
    expect(unwrapErr(await verifyKnockAccess({ get }))).toEqual(denied);
    expect(seen.length).toBe(1);
  });

  it("passes a failure on the second read through unchanged", async () => {
    const limited = KnockReadErrors.transportFailed({ operation: "knock.messages.list", status: 429 });
    const { get } = queuedGet({ bodies: [EMPTY, limited] });
    expect(unwrapErr(await verifyKnockAccess({ get }))).toEqual(limited);
  });
});

describe("listKnockMessages", () => {
  it("sends every filter, repeats status, and projects delivery facts only", async () => {
    const { get, seen } = queuedGet({
      bodies: [listPage({ after: null, items: [wireMessage({ id: "m-1", status: "undelivered" })] })],
    });
    const list = unwrap(
      await listKnockMessages({
        filter: {
          ...NO_FILTER,
          channelId: "chan-sms",
          insertedAfter: "2026-10-11T00:00:00Z",
          insertedBefore: "2026-10-12T00:00:00Z",
          statuses: ["undelivered", "bounced"],
        },
        get,
        limit: 10,
      }),
    );
    expect([...seen[0]!.url.searchParams.entries()]).toEqual([
      ["channel_id", "chan-sms"],
      ["inserted_at.gte", "2026-10-11T00:00:00Z"],
      ["inserted_at.lte", "2026-10-12T00:00:00Z"],
      ["status", "undelivered"],
      ["status", "bounced"],
      ["page_size", "10"],
    ]);
    expect(list).toEqual({
      items: [
        {
          channelId: "chan-sms",
          channelProvider: "twilio",
          channelType: "sms",
          id: "m-1",
          insertedAt: "2026-10-11T03:12:00.000000Z",
          scheduledAt: null,
          sourceKey: "booking-reminder",
          sourceType: "workflow",
          status: "undelivered",
          stepRef: "sms_1",
          updatedAt: "2026-10-11T03:12:09.000000Z",
          workflowRecipientRunId: "wrr-1",
          workflowRunId: "wr-1",
        },
      ],
      moreRemain: false,
      pages: 1,
    });
  });

  it("never lets a recipient, payload, phone number, branch step or cursor reach a view or a rendered line", async () => {
    const body = listPage({ after: null, items: [wireListMessage({ id: "m-1", status: "delivered" })] });
    expect(body).toContain(SENTINEL_BRANCH_STEP);
    expect(body).toContain(SENTINEL_CURSOR);
    const { get } = queuedGet({ bodies: [body] });
    const list = unwrap(await listKnockMessages({ filter: NO_FILTER, get, limit: 10 }));
    const printed = JSON.stringify(list) + list.items.flatMap((view) => renderKnockMessage({ view })).join("\n");
    expect(printed).toContain("m-1");
    expect(printed).not.toContain(SENTINEL_RECIPIENT);
    expect(printed).not.toContain(SENTINEL_PAYLOAD);
    expect(printed).not.toContain(SENTINEL_PHONE);
    expect(printed).not.toContain(SENTINEL_BRANCH_STEP);
    expect(printed).not.toContain(SENTINEL_CURSOR);
  });

  it("follows the `after` cursor and says when the caller's limit cut the list", async () => {
    const { get, seen } = queuedGet({
      bodies: [
        listPage({ after: "c-1", items: [wireMessage({ id: "m-1", status: "sent" })] }),
        listPage({
          after: "c-2",
          items: [wireMessage({ id: "m-2", status: "sent" }), wireMessage({ id: "m-3", status: "sent" })],
        }),
      ],
    });
    const list = unwrap(await listKnockMessages({ filter: NO_FILTER, get, limit: 2 }));
    expect(list.items.map((view) => view.id)).toEqual(["m-1", "m-2"]);
    expect([list.moreRemain, list.pages]).toEqual([true, 2]);
    expect(seen.map((request) => request.url.searchParams.get("after"))).toEqual([null, "c-1"]);
  });

  it("refuses a cursor it already followed rather than looping", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({ after: "c-1", items: [wireMessage({ id: "m-1", status: "sent" })] }),
        listPage({ after: "c-1", items: [wireMessage({ id: "m-2", status: "sent" })] }),
      ],
    });
    expect(unwrapErr(await listKnockMessages({ filter: NO_FILTER, get, limit: 10 }))).toEqual(
      KnockReadErrors.paginationRefused({ why: "Knock answered a cursor this read already followed" }),
    );
  });

  it("refuses a list needing more than the page ceiling rather than truncating it", async () => {
    const bodies = Array.from({ length: KNOCK_MAX_PAGES }, (_, index) =>
      listPage({ after: `c-${String(index)}`, items: [wireMessage({ id: `m-${String(index)}`, status: "sent" })] }),
    );
    const { get, seen } = queuedGet({ bodies });
    expect(unwrapErr(await listKnockMessages({ filter: NO_FILTER, get, limit: 1000 }))).toEqual(
      KnockReadErrors.paginationRefused({
        why: `the list needs more than ${String(KNOCK_MAX_PAGES)} pages — narrow the window or the filters`,
      }),
    );
    expect(seen.length).toBe(KNOCK_MAX_PAGES);
  });

  it("refuses a body with a key the pinned document does not declare, never reading it as empty", async () => {
    const drifted = { ...wireMessage({ id: "m-1", status: "sent" }), phone_number: SENTINEL_PHONE };
    const { get } = queuedGet({ bodies: [listPage({ after: null, items: [drifted] })] });
    const refused = unwrapErr(await listKnockMessages({ filter: NO_FILTER, get, limit: 10 }));
    expect(refused.code).toBe("RESPONSE_REFUSED");
    expect(refused.message).toContain("GET /v1/messages answered a body this door will not read");
  });

  it("withholds an undeclared key that is a phone number rather than naming it in the refusal", async () => {
    const recipient = { collection: "users", id: "u-1", [SENTINEL_PHONE]: true };
    const drifted = { ...wireMessage({ id: "m-1", status: "sent" }), recipient };
    const { get } = queuedGet({ bodies: [listPage({ after: null, items: [drifted] })] });
    expect(Object.keys(recipient)).toContain(SENTINEL_PHONE);
    expect(unwrapErr(await listKnockMessages({ filter: NO_FILTER, get, limit: 10 }))).toEqual(
      KnockReadErrors.responseRefused({
        endpoint: "GET /v1/messages",
        why: 'the shape changed: new field "items[#].recipient.‹withheld key›"',
      }),
    );
  });

  it("refuses a body that is not JSON", async () => {
    const { get } = queuedGet({ bodies: ["<html>gateway</html>"] });
    expect(unwrapErr(await listKnockMessages({ filter: NO_FILTER, get, limit: 10 })).code).toBe("RESPONSE_REFUSED");
  });
});

describe("listKnockUserMessages", () => {
  it("sends the user id in the path under its own operation", async () => {
    const { get, seen } = queuedGet({ bodies: [listPage({ after: null, items: [] })] });
    const list = unwrap(await listKnockUserMessages({ filter: NO_FILTER, get, limit: 5, userId: "user_0123" }));
    expect(list).toEqual({ items: [], moreRemain: false, pages: 1 });
    expect(seen.map((request) => [request.operation, request.url.pathname])).toEqual([
      ["knock.users.messages.list", "/v1/users/user_0123/messages"],
    ]);
  });
});

describe("readKnockMessage", () => {
  it("reads one message by id", async () => {
    const { get, seen } = queuedGet({ bodies: [JSON.stringify(wireMessage({ id: "m-9", status: "bounced" }))] });
    const view = unwrap(await readKnockMessage({ get, messageId: "m-9" }));
    expect([view.id, view.status]).toEqual(["m-9", "bounced"]);
    expect(seen.map((request) => request.url.pathname)).toEqual(["/v1/messages/m-9"]);
  });

  it("refuses an unsafe id before any request", async () => {
    const { get, seen } = queuedGet({ bodies: [] });
    expect(unwrapErr(await readKnockMessage({ get, messageId: "../users" }))).toEqual(
      KnockReadErrors.urlRefused({
        operation: "knock.message.read",
        why: "it takes one message id with no path character in it",
      }),
    );
    expect(seen).toEqual([]);
  });
});

describe("listKnockMessageEvents", () => {
  it("projects each event to its type and time, never its data", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          after: null,
          items: [
            wireEvent({ id: "e-1", type: "message.sent" }),
            wireEvent({ id: "e-2", type: "message.undelivered" }),
          ],
        }),
      ],
    });
    const list = unwrap(await listKnockMessageEvents({ get, limit: 10, messageId: "m-1" }));
    expect(list.items).toEqual([
      { id: "e-1", insertedAt: "2026-10-11T03:12:05.000000Z", type: "message.sent" },
      { id: "e-2", insertedAt: "2026-10-11T03:12:05.000000Z", type: "message.undelivered" },
    ]);
    expect(JSON.stringify(list)).not.toContain(SENTINEL_PAYLOAD);
  });
});

describe("listKnockDeliveryLogs", () => {
  it("keeps the service and the provider's status, never a request or response body or header", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          after: null,
          items: [wireDeliveryLog({ id: "d-1", status: 400 }), wireDeliveryLog({ id: "d-2", status: undefined })],
        }),
      ],
    });
    const list = unwrap(await listKnockDeliveryLogs({ get, limit: 10, messageId: "m-1" }));
    expect(list.items).toEqual([
      { id: "d-1", insertedAt: "2026-10-11T03:12:02.000000Z", responseStatus: 400, serviceName: "twilio" },
      { id: "d-2", insertedAt: "2026-10-11T03:12:02.000000Z", responseStatus: null, serviceName: "twilio" },
    ]);
    const printed = JSON.stringify(list);
    expect(printed).not.toContain(SENTINEL_PAYLOAD);
    expect(printed).not.toContain(SENTINEL_PHONE);
    expect(printed).not.toContain("SENTINEL");
  });
});
