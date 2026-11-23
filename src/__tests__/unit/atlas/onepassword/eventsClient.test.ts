/**
 * What the Events API client says about each way a response can go wrong, driven through a plain fake
 * `fetch` so no network is reached. The token is a fake of plausible length; no message may carry it.
 */
import { describe, expect, it } from "vitest";

import { createOnepasswordEventsClient } from "../../../../atlas/onepassword/eventsClient.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const CREDENTIALS = { host: "events.example.test", token: "abcdefghijklmnopqrstuvwx" };

const SINCE = "2026-09-01T00:00:00Z";

/** One audit event carrying only the three keys the atlas floor requires. */
const EVENT = { action: "signin", timestamp: "2026-09-02T00:00:00Z", uuid: "EVENTEVENTEVENTEVENTEVENTA" };

/** A client whose every request is answered with one fixed status and body. */
function answering({
  status,
  body,
}: {
  status: number;
  body: string;
}): ReturnType<typeof createOnepasswordEventsClient> {
  return createOnepasswordEventsClient({
    credentials: CREDENTIALS,
    fetchImpl: async () => ({ status, text: async () => body }),
  });
}

/** A client answering successive pages in order, and keeping every request body it was sent. */
function paging({ pages }: { pages: readonly Record<string, unknown>[] }): {
  client: ReturnType<typeof createOnepasswordEventsClient>;
  sent: (string | undefined)[];
} {
  const queue = pages.map((page) => JSON.stringify(page));
  const sent: (string | undefined)[] = [];
  const client = createOnepasswordEventsClient({
    credentials: CREDENTIALS,
    fetchImpl: async (_url, init) => {
      sent.push(init.body);
      const body = queue.shift()!;
      return { status: 200, text: async () => body };
    },
  });
  return { client, sent };
}

describe("the Events API client's walk", () => {
  it("follows the cursor until has_more is false, keeping every item in order", async () => {
    const second = { ...EVENT, uuid: "EVENTEVENTEVENTEVENTEVENTB" };
    const { client, sent } = paging({
      pages: [
        { cursor: "CURSOR-1", has_more: true, items: [EVENT] },
        { cursor: "CURSOR-2", has_more: false, items: [second] },
      ],
    });

    const walk = unwrap(await client.listAuditEvents({ since: SINCE }));

    expect(walk).toEqual({ items: [EVENT, second], truncated: false });
    expect(sent).toEqual([JSON.stringify({ limit: 1000, start_time: SINCE }), JSON.stringify({ cursor: "CURSOR-1" })]);
  });
});

describe("the Events API client's refusals", () => {
  it("names a refused token on 401", async () => {
    expect(unwrapErr(await answering({ body: "", status: 401 }).listAuditEvents({ since: SINCE }))).toEqual([
      "/api/v2/auditevents returned HTTP 401 — the Events API token was refused",
      "either the token is wrong, it has expired, or the account is served from a different region than ONEPASSWORD_EVENTS_HOST names",
    ]);
  });

  it("names a missing event family on 403", async () => {
    expect(unwrapErr(await answering({ body: "", status: 403 }).listAuditEvents({ since: SINCE }))).toEqual([
      "/api/v2/auditevents returned HTTP 403 — this token was not issued with the event family this surface needs",
      "re-issue it at 1Password.com → Integrations → Events Reporting with that family ticked",
    ]);
  });

  it("names any other status bare", async () => {
    expect(unwrapErr(await answering({ body: "", status: 500 }).listAuditEvents({ since: SINCE }))).toEqual([
      "/api/v2/auditevents returned HTTP 500",
    ]);
  });

  it("refuses a body that is not JSON, without echoing it", async () => {
    expect(unwrapErr(await answering({ body: "not json", status: 200 }).listAuditEvents({ since: SINCE }))).toEqual([
      "POST /api/v2/auditevents answered a body that is not JSON",
    ]);
  });

  it("refuses a page with no cursor rather than reading it as the end of the walk", async () => {
    const body = JSON.stringify({ has_more: true, items: [] });
    expect(unwrapErr(await answering({ body, status: 200 }).listAuditEvents({ since: SINCE }))).toEqual([
      'POST /api/v2/auditevents answered a shape this version does not read — refused, not guessed: field "cursor" is missing',
    ]);
  });

  it("refuses an item key 1Password added, naming the key and never the value it carried", async () => {
    const leaked = "DO_NOT_ECHO_7f3a";
    const body = JSON.stringify({ cursor: "C", has_more: false, items: [{ ...EVENT, item_title: leaked }] });
    const lines = unwrapErr(await answering({ body, status: 200 }).listAuditEvents({ since: SINCE }));

    expect(body).toContain(leaked);
    expect(lines).toEqual([
      'POST /api/v2/auditevents answered a shape this version does not read — refused, not guessed: new field "items[0].item_title"',
    ]);
    expect(lines.join("\n")).not.toContain(leaked);
  });

  it("names the method and path of a request that threw", async () => {
    const client = createOnepasswordEventsClient({
      credentials: CREDENTIALS,
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });

    expect(unwrapErr(await client.listAuditEvents({ since: SINCE }))).toEqual([
      "POST /api/v2/auditevents failed: ECONNRESET",
    ]);
  });
});
