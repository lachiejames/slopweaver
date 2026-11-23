import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareAccountFilterListInventory,
  readCloudflareAccountFilterListItems,
} from "../../../../../atlas/cloudflare/readers/accountFilterList.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

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

/** A `fetch` stub matching one pathname substring, returning `items` as a single (non-paginated) page. */
function singlePagePathFetch({ match, items }: { match: string; items: readonly unknown[] }): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (!url.pathname.includes(match)) {
      return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
    }
    return jsonResponse({ body: { result: items, result_info: {}, success: true }, status: 200 });
  };
}

describe("readCloudflareAccountFilterListInventory", () => {
  it("reads every list's metadata", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({
        items: [{ id: "list-1", kind: "ip", name: "blocklist", num_items: 2, num_referencing_filters: 0 }],
        match: "/rules/lists",
      }),
      maxRetries: 0,
    });
    const lists = unwrap(await readCloudflareAccountFilterListInventory({ accountId: ACCOUNT_ID, client }));
    expect(lists.map((list) => list.id)).toEqual(["list-1"]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccountFilterListInventory({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareAccountFilterListItems", () => {
  it("reads one list's items, exhausting the cursor", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ id: "item-1", ip: "10.0.0.1" }], match: "/rules/lists/list-1/items" }),
      maxRetries: 0,
    });
    const items = unwrap(
      await readCloudflareAccountFilterListItems({ accountId: ACCOUNT_ID, client, listId: "list-1" }),
    );
    expect(items).toEqual([{ id: "item-1", ip: "10.0.0.1" }]);
  });

  it("skips an item whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ ip: "10.0.0.1" }], match: "/rules/lists/list-1/items" }),
      maxRetries: 0,
    });
    const items = unwrap(
      await readCloudflareAccountFilterListItems({ accountId: ACCOUNT_ID, client, listId: "list-1" }),
    );
    expect(items).toEqual([]);
  });

  it("maps a not-found error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccountFilterListItems({ accountId: ACCOUNT_ID, client, listId: "list-1" });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});
