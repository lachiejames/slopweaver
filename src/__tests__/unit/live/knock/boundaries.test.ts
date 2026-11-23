/**
 * The Knock door's strict boundaries read every shape the pinned document declares, plus the list item's live
 * `__cursor`, and refuse one it does not — an added key, a status outside the enum, a delivery log with an
 * undeclared response field — naming the endpoint, so drift fails a read instead of reading as success.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  GET_KNOCK_MESSAGE,
  LIST_KNOCK_DELIVERY_LOGS,
  LIST_KNOCK_MESSAGE_EVENTS,
  LIST_KNOCK_MESSAGES,
  LIST_KNOCK_USER_MESSAGES,
} from "../../../../live/knock/boundaries.js";
import {
  listPage,
  SENTINEL_BRANCH_STEP,
  wireDeliveryLog,
  wireEvent,
  wireListMessage,
  wireMessage,
} from "./knockFixtures.js";

describe("the Knock boundaries", () => {
  it("read each declared shape", () => {
    const message = wireMessage({ id: "m-1", status: "delivered" });
    expect(unwrap(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(message) })).id).toBe("m-1");
    expect(
      unwrap(LIST_KNOCK_MESSAGES.parseJson({ text: listPage({ after: "c-1", items: [message] }) })).page_info.after,
    ).toBe("c-1");
    expect(unwrap(LIST_KNOCK_USER_MESSAGES.parseJson({ text: listPage({ after: null, items: [] }) })).items).toEqual(
      [],
    );
    expect(
      unwrap(
        LIST_KNOCK_MESSAGE_EVENTS.parseJson({
          text: listPage({ after: null, items: [wireEvent({ id: "e-1", type: "message.sent" })] }),
        }),
      ).items.map((event) => event.type),
    ).toEqual(["message.sent"]);
    expect(
      unwrap(
        LIST_KNOCK_DELIVERY_LOGS.parseJson({
          text: listPage({ after: null, items: [wireDeliveryLog({ id: "d-1", status: 201 })] }),
        }),
      ).items.map((log) => log.response.status),
    ).toEqual([201]);
  });

  it("refuse a key the pinned document does not declare, naming the endpoint", () => {
    const drifted = { ...wireMessage({ id: "m-1", status: "sent" }), recipient_phone: "+61400000123" };
    const refused = unwrapErr(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(drifted) }));
    expect(refused.message).toContain("GET /v1/messages/{message_id}");
    expect(refused.message).toContain("recipient_phone");
  });

  it("read a list item carrying the __cursor and source.branch_path live Knock answered, on both lists", () => {
    const page = listPage({ after: null, items: [wireListMessage({ id: "m-1", status: "delivered" })] });
    expect(unwrap(LIST_KNOCK_MESSAGES.parseJson({ text: page })).items.map((item) => item.source.branch_path)).toEqual([
      [{ branch_id: "123e4567-e89b-12d3-a456-426614174000", step_ref: SENTINEL_BRANCH_STEP, step_type: "branch" }],
    ]);
    expect(unwrap(LIST_KNOCK_USER_MESSAGES.parseJson({ text: page })).items.map((item) => item.id)).toEqual(["m-1"]);
  });

  it("read one message carrying source.branch_path, and refuse __cursor there, where no read has seen it", () => {
    const branched = wireMessage({ id: "m-1", status: "delivered" });
    expect(unwrap(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(branched) })).id).toBe("m-1");
    const listShaped = wireListMessage({ id: "m-1", status: "delivered" });
    expect(unwrapErr(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(listShaped) })).message).toContain("__cursor");
  });

  it("read a source whose branch_path is null, and one that omits it", () => {
    const message = wireMessage({ id: "m-1", status: "sent" });
    const source = message["source"] as Record<string, unknown>;
    const unbranched = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "branch_path"));
    const nulled = { ...message, source: { ...source, branch_path: null } };
    const omitted = { ...message, source: unbranched };
    expect(unwrap(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(nulled) })).source.branch_path).toBe(null);
    expect(unwrap(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(omitted) })).source.branch_path).toBe(undefined);
  });

  it("refuse a branch_path segment key the document does not declare, naming it", () => {
    const message = wireMessage({ id: "m-1", status: "sent" });
    const source = message["source"] as Record<string, unknown>;
    const segment = { branch_id: "b-1", branch_name: "control", step_ref: "experiment", step_type: "random_cohort" };
    const drifted = { ...message, source: { ...source, branch_path: [segment] } };
    const refused = unwrapErr(LIST_KNOCK_MESSAGES.parseJson({ text: listPage({ after: null, items: [drifted] }) }));
    expect(refused.message).toContain("branch_name");
  });

  it("read the page_info.total_count live Knock answers, and a page without it", () => {
    const page = { __typename: "PageInfo", after: null, before: null, page_size: 50 };
    const withCount = JSON.stringify({ items: [], page_info: { ...page, total_count: 3 } });
    const without = JSON.stringify({ items: [], page_info: page });
    expect(unwrap(LIST_KNOCK_MESSAGES.parseJson({ text: withCount })).page_info.total_count).toBe(3);
    expect(unwrap(LIST_KNOCK_MESSAGES.parseJson({ text: without })).page_info.total_count).toBe(undefined);
  });

  it("refuse a page_info.total_count that is not an integer", () => {
    const page = { __typename: "PageInfo", after: null, before: null, page_size: 50, total_count: "3" };
    const refused = unwrapErr(LIST_KNOCK_MESSAGES.parseJson({ text: JSON.stringify({ items: [], page_info: page }) }));
    expect(refused.message).toContain("total_count");
  });

  it("refuse a status outside the documented set", () => {
    const unknown = wireMessage({ id: "m-1", status: "opened" });
    expect(unwrapErr(GET_KNOCK_MESSAGE.parseJson({ text: JSON.stringify(unknown) })).message).toContain("status");
  });

  it("refuse a delivery log response field the document does not declare", () => {
    const log = wireDeliveryLog({ id: "d-1", status: 201 });
    const drifted = { ...log, response: { ...(log["response"] as Record<string, unknown>), latency_ms: 12 } };
    expect(
      unwrapErr(LIST_KNOCK_DELIVERY_LOGS.parseJson({ text: listPage({ after: null, items: [drifted] }) })).message,
    ).toContain("latency_ms");
  });
});
