import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareAccessApplicationPolicies,
  readCloudflareAccessReusablePolicies,
} from "../../../../../atlas/cloudflare/readers/accessPolicy.js";
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

/** A `fetch` stub matching one pathname substring, returning `items` on page 1 and an empty page 2. */
function singlePagePathFetch({ match, items }: { match: string; items: readonly unknown[] }): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (!url.pathname.includes(match)) {
      return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
    }
    const page = requestedPage({ url });
    const result = page === 1 ? items : [];
    return jsonResponse({ body: { result, result_info: { count: result.length, page }, success: true }, status: 200 });
  };
}

describe("readCloudflareAccessReusablePolicies", () => {
  it("reads every reusable policy", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({
        items: [{ id: "pol-1", app_count: 3, name: "Reusable", reusable: true }],
        match: "/access/policies",
      }),
      maxRetries: 0,
    });
    const policies = unwrap(await readCloudflareAccessReusablePolicies({ accountId: ACCOUNT_ID, client }));
    expect(policies.map((policy) => policy.id)).toEqual(["pol-1"]);
  });

  it("skips a policy whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ name: "No id" }], match: "/access/policies" }),
      maxRetries: 0,
    });
    const policies = unwrap(await readCloudflareAccessReusablePolicies({ accountId: ACCOUNT_ID, client }));
    expect(policies).toEqual([]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccessReusablePolicies({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareAccessApplicationPolicies", () => {
  it("reads one application's current policies", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({
        items: [{ id: "pol-1", decision: "allow", precedence: 1 }],
        match: "/access/apps/app-1/policies",
      }),
      maxRetries: 0,
    });
    const policies = unwrap(
      await readCloudflareAccessApplicationPolicies({ accountId: ACCOUNT_ID, applicationId: "app-1", client }),
    );
    expect(policies).toEqual([{ id: "pol-1", decision: "allow", precedence: 1 }]);
  });

  it("maps a not-found error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccessApplicationPolicies({
      accountId: ACCOUNT_ID,
      applicationId: "app-1",
      client,
    });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});
