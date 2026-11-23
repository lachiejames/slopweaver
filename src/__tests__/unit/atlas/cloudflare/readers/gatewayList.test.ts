import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareGatewayListInventory,
  readCloudflareGatewayListItems,
} from "../../../../../atlas/cloudflare/readers/gatewayList.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it — never `String(input)`, which would stringify a `Request`
 * via its default `Object` conversion rather than its actual URL. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/** A `fetch` stub matching one pathname substring, returning `items` on page 1 and an empty page after, so a
 * page-paginated list (the items sub-resource, from `cloudflare` 7.2.0) terminates as a single page does. */
function singlePagePathFetch({ match, items }: { match: string; items: readonly unknown[] }): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (!url.pathname.includes(match)) {
      return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
    }
    const page = requestedPage({ url });
    return jsonResponse({ body: { result: page === 1 ? items : [], success: true }, status: 200 });
  };
}

describe("readCloudflareGatewayListInventory", () => {
  it("reads every list's metadata", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ count: 2, id: "list-1", name: "IPs" }], match: "/gateway/lists" }),
      maxRetries: 0,
    });
    const lists = unwrap(await readCloudflareGatewayListInventory({ accountId: ACCOUNT_ID, client }));
    expect(lists.map((list) => list.id)).toEqual(["list-1"]);
  });

  it("skips a list whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ name: "No id" }], match: "/gateway/lists" }),
      maxRetries: 0,
    });
    const lists = unwrap(await readCloudflareGatewayListInventory({ accountId: ACCOUNT_ID, client }));
    expect(lists).toEqual([]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareGatewayListInventory({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareGatewayListItems", () => {
  it("reads one list's items", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({
        items: [{ description: null, value: "10.0.0.1" }],
        match: "/gateway/lists/list-1/items",
      }),
      maxRetries: 0,
    });
    const items = unwrap(await readCloudflareGatewayListItems({ accountId: ACCOUNT_ID, client, listId: "list-1" }));
    expect(items).toEqual([{ description: null, value: "10.0.0.1" }]);
  });

  it("maps a not-found error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 }),
      maxRetries: 0,
    });
    const result = await readCloudflareGatewayListItems({ accountId: ACCOUNT_ID, client, listId: "list-1" });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});
