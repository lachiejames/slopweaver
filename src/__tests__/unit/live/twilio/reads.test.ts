/**
 * The Twilio reads over a fake seam: verify fetches no record, a list pages to the limit and says when it was cut,
 * a repeated next page or one past the ceiling is refused rather than truncated, a body the strict boundary will
 * not read is a refusal and never an empty list, and no view ever carries a body or a full phone number.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { GET_TWILIO_MESSAGE } from "../../../../live/twilio/boundaries.js";
import { TwilioReadErrors } from "../../../../live/twilio/errors.js";
import {
  maskPhone,
  projectTwilioMessage,
  renderTwilioMessage,
  WITHHELD_ADDRESS,
} from "../../../../live/twilio/projection.js";
import {
  listTwilioMessages,
  readTwilioMessage,
  TWILIO_MAX_PAGES,
  type TwilioMessageFilter,
  verifyTwilioAccess,
} from "../../../../live/twilio/reads.js";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_TO,
  listPage,
  queuedGet,
  SENTINEL_BODY,
  sidOf,
  wireMessage,
} from "./twilioFixtures.js";

const NO_FILTER: TwilioMessageFilter = { from: null, sentAfter: null, sentBefore: null, to: null };
const nextPageOf = ({ page }: { page: number }): string =>
  `/2010-04-01/Accounts/${FIXTURE_ACCOUNT}/Messages.json?PageSize=2&Page=${String(page)}&PageToken=PA${String(page)}`;

describe("verifyTwilioAccess", () => {
  it("asks for one message sent before 2000 and answers true on a readable empty page", async () => {
    const { get, seen } = queuedGet({ bodies: [listPage({ messages: [], nextPageUri: null })] });
    expect(unwrap(await verifyTwilioAccess({ accountSid: FIXTURE_ACCOUNT, get }))).toBe(true);
    expect([...seen[0]!.searchParams.entries()]).toEqual([
      ["DateSent<", "2000-01-01"],
      ["PageSize", "1"],
    ]);
  });

  it("passes a failed GET through unchanged", async () => {
    const failure = TwilioReadErrors.transportFailed({ message: "Twilio answered 401 on /x", status: 401 });
    const { get } = queuedGet({ bodies: [failure] });
    expect(unwrapErr(await verifyTwilioAccess({ accountSid: FIXTURE_ACCOUNT, get }))).toEqual(failure);
  });
});

describe("listTwilioMessages", () => {
  it("sends every filter under Twilio's own key and projects each message", async () => {
    const { get, seen } = queuedGet({
      bodies: [
        listPage({
          messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "delivered" })],
          nextPageUri: null,
        }),
      ],
    });
    const listed = unwrap(
      await listTwilioMessages({
        accountSid: FIXTURE_ACCOUNT,
        filter: { from: "Acme", sentAfter: "2026-10-11", sentBefore: "2026-10-12", to: FIXTURE_TO },
        get,
        limit: 50,
      }),
    );
    expect([...seen[0]!.searchParams.entries()]).toEqual([
      ["PageSize", "50"],
      ["To", FIXTURE_TO],
      ["From", "Acme"],
      ["DateSent>", "2026-10-11"],
      ["DateSent<", "2026-10-12"],
    ]);
    expect(listed.messages.map((view) => [view.sid, view.status, view.to])).toEqual([
      [sidOf({ digit: "1" }), "delivered", "+••••••••123"],
    ]);
    expect(listed.moreRemain).toBe(false);
    expect(listed.pages).toBe(1);
  });

  it("follows next pages and stops at the limit, saying more remain", async () => {
    const { get, seen } = queuedGet({
      bodies: [
        listPage({
          messages: [
            wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "delivered" }),
            wireMessage({ errorCode: null, sid: sidOf({ digit: "2" }), status: "delivered" }),
          ],
          nextPageUri: nextPageOf({ page: 1 }),
        }),
        listPage({
          messages: [
            wireMessage({ errorCode: 30003, sid: sidOf({ digit: "3" }), status: "undelivered" }),
            wireMessage({ errorCode: null, sid: sidOf({ digit: "4" }), status: "sent" }),
          ],
          nextPageUri: nextPageOf({ page: 2 }),
        }),
      ],
    });
    const listed = unwrap(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 3 }));
    expect(listed.messages.map((view) => view.sid)).toEqual([
      sidOf({ digit: "1" }),
      sidOf({ digit: "2" }),
      sidOf({ digit: "3" }),
    ]);
    expect(listed.moreRemain).toBe(true);
    expect(listed.pages).toBe(2);
    expect(seen.map((url) => url.searchParams.get("Page"))).toEqual([null, "1"]);
  });

  it("reports nothing more when the limit is met exactly on the last page", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "sent" })],
          nextPageUri: null,
        }),
      ],
    });
    const listed = unwrap(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 1 }));
    expect(listed.moreRemain).toBe(false);
  });

  it("answers an empty list for an empty page — the answer, not a failure", async () => {
    const { get } = queuedGet({ bodies: [listPage({ messages: [], nextPageUri: null })] });
    expect(
      unwrap(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 5 })).messages,
    ).toEqual([]);
  });

  it("refuses a next page it already fetched rather than looping", async () => {
    const page = listPage({
      messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "sent" })],
      nextPageUri: nextPageOf({ page: 1 }),
    });
    const { get } = queuedGet({ bodies: [page, page] });
    expect(
      unwrapErr(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 100 })),
    ).toEqual(TwilioReadErrors.paginationRefused({ why: "Twilio answered a next page this read already fetched" }));
  });

  it("refuses a list needing more than the page ceiling rather than truncating it", async () => {
    const bodies = Array.from({ length: TWILIO_MAX_PAGES }, (_, page) =>
      listPage({
        messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "sent" })],
        nextPageUri: nextPageOf({ page: page + 1 }),
      }),
    );
    const { get } = queuedGet({ bodies });
    expect(
      unwrapErr(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 5000 })),
    ).toEqual(
      TwilioReadErrors.paginationRefused({
        why: `the list needs more than ${String(TWILIO_MAX_PAGES)} pages — narrow the window or the number`,
      }),
    );
  });

  it("refuses a next page that leaves the closed call list, naming the field and never the provider's path", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "sent" })],
          nextPageUri: "/recipient@example.com",
        }),
      ],
    });
    expect(
      unwrapErr(await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 10 })),
    ).toEqual(
      TwilioReadErrors.urlRefused({ path: "next_page_uri", why: "Twilio's next page leaves the closed call list" }),
    );
  });

  it("refuses a page carrying a key the boundary does not know, naming the endpoint", async () => {
    const drifted = JSON.stringify({ ...JSON.parse(listPage({ messages: [], nextPageUri: null })), surprise: 1 });
    const { get } = queuedGet({ bodies: [drifted] });
    const refused = unwrapErr(
      await listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 10 }),
    );
    expect(refused.code).toBe("RESPONSE_REFUSED");
    expect(refused.message).toContain("GET /2010-04-01/Accounts/{AccountSid}/Messages.json");
  });

  it("throws on a limit the parser should have bounded", async () => {
    const { get } = queuedGet({ bodies: [] });
    await expect(listTwilioMessages({ accountSid: FIXTURE_ACCOUNT, filter: NO_FILTER, get, limit: 0 })).rejects.toThrow(
      "listTwilioMessages: limit 0 is outside 1..5000; the parser bounds it",
    );
  });
});

describe("readTwilioMessage", () => {
  it("reads one message by SID and projects it", async () => {
    const sid = sidOf({ digit: "9" });
    const { get, seen } = queuedGet({
      bodies: [JSON.stringify(wireMessage({ errorCode: 30003, sid, status: "undelivered" }))],
    });
    const view = unwrap(await readTwilioMessage({ accountSid: FIXTURE_ACCOUNT, get, sid }));
    expect(seen[0]!.pathname).toBe(`/2010-04-01/Accounts/${FIXTURE_ACCOUNT}/Messages/${sid}.json`);
    expect(view).toEqual({
      createdAt: "2026-10-11T03:12:00.000Z",
      direction: "outbound-api",
      errorCode: 30003,
      errorDocs: "https://www.twilio.com/docs/api/errors/30003",
      from: "+••••••••999",
      messagingServiceSid: `MG${"c".repeat(32)}`,
      segments: "1",
      sentAt: "2026-10-11T03:12:01.000Z",
      sid,
      status: "undelivered",
      to: "+••••••••123",
      updatedAt: "2026-10-11T03:12:09.000Z",
    });
  });

  it("refuses a value that is not a message SID before any request", async () => {
    const { get, seen } = queuedGet({ bodies: [] });
    expect(unwrapErr(await readTwilioMessage({ accountSid: FIXTURE_ACCOUNT, get, sid: "SMnope" })).code).toBe(
      "URL_REFUSED",
    );
    expect(seen).toEqual([]);
  });
});

describe("projection", () => {
  it("masks every digit but the last three, keeping a documented channel prefix", () => {
    expect(maskPhone({ side: "to", value: "+61400000123" })).toBe("+••••••••123");
    expect(maskPhone({ side: "to", value: "whatsapp:+61400000123" })).toBe("whatsapp:+••••••••123");
    expect(maskPhone({ side: "to", value: "123" })).toBe("•••");
    expect(maskPhone({ side: "from", value: "1234" })).toBe("•234");
  });

  it("keeps a sender id only on the sending side, and withholds anything else that is not phone-shaped", () => {
    expect(maskPhone({ side: "from", value: "Acme" })).toBe("Acme");
    expect(
      [
        { side: "to" as const, value: "Acme" },
        { side: "to" as const, value: "customer@example.com" },
        { side: "from" as const, value: "customer1@example.com" },
        { side: "to" as const, value: "jane.smith+12345@example.com" },
        { side: "to" as const, value: "jane:+61400000123" },
        { side: "from" as const, value: "whatsapp:Acme" },
      ].map((address) => maskPhone(address)),
    ).toEqual(Array.from({ length: 6 }, () => WITHHELD_ADDRESS));
  });

  it("never carries the body, nor a full number, into a view or a rendered line", () => {
    const message = unwrap(
      GET_TWILIO_MESSAGE.parseJson({
        text: JSON.stringify(wireMessage({ errorCode: null, sid: sidOf({ digit: "5" }), status: "sent" })),
      }),
    );
    const view = unwrap(projectTwilioMessage({ message }));
    const printed = [JSON.stringify(view), ...renderTwilioMessage({ view })].join("\n");
    expect(JSON.stringify(message)).toContain(SENTINEL_BODY);
    expect(printed).not.toContain("SENTINEL-CUSTOMER-BODY");
    expect(JSON.stringify(message)).toContain(FIXTURE_TO);
    expect(printed).not.toContain(FIXTURE_TO);
  });

  it("prints the error code and its page, never Twilio's free-text error message", () => {
    const message = unwrap(
      GET_TWILIO_MESSAGE.parseJson({
        text: JSON.stringify({
          ...wireMessage({ errorCode: 30003, sid: sidOf({ digit: "4" }), status: "undelivered" }),
          error_message: `Delivery failed for ${FIXTURE_TO}`,
        }),
      }),
    );
    const view = unwrap(projectTwilioMessage({ message }));
    const printed = [JSON.stringify(view), ...renderTwilioMessage({ view })].join("\n");
    expect(message.error_message).toBe(`Delivery failed for ${FIXTURE_TO}`);
    expect(printed).not.toContain(FIXTURE_TO);
    expect(renderTwilioMessage({ view })[0]).toBe(
      `${sidOf({ digit: "4" })}  undelivered (error 30003, https://www.twilio.com/docs/api/errors/30003)`,
    );
  });

  it("refuses a date Twilio does not document rather than passing it through", () => {
    const message = unwrap(
      GET_TWILIO_MESSAGE.parseJson({
        text: JSON.stringify({
          ...wireMessage({ errorCode: null, sid: sidOf({ digit: "6" }), status: "sent" }),
          date_sent: "yesterday-ish",
        }),
      }),
    );
    expect(unwrapErr(projectTwilioMessage({ message }))).toEqual(
      TwilioReadErrors.responseRefused({
        endpoint: GET_TWILIO_MESSAGE.endpoint,
        why: "date_sent is not a date Twilio documents",
      }),
    );
  });

  it("renders the outcome with the error code, and says `not sent` when Twilio has no send time", () => {
    const message = unwrap(
      GET_TWILIO_MESSAGE.parseJson({
        text: JSON.stringify({
          ...wireMessage({ errorCode: 30005, sid: sidOf({ digit: "7" }), status: "failed" }),
          date_sent: null,
        }),
      }),
    );
    expect(renderTwilioMessage({ view: unwrap(projectTwilioMessage({ message })) })).toEqual([
      `${sidOf({ digit: "7" })}  failed (error 30005, https://www.twilio.com/docs/api/errors/30005)`,
      "    outbound-api  from +••••••••999  to +••••••••123  segments 1",
      "    created 2026-10-11T03:12:00.000Z  not sent  updated 2026-10-11T03:12:09.000Z",
    ]);
  });
});
