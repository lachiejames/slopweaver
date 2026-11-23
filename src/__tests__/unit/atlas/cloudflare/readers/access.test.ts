import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareAccessApplications,
  readCloudflareAccessGroups,
  readCloudflareAccessServiceTokens,
  readCloudflareIdentityProviders,
} from "../../../../../atlas/cloudflare/readers/access.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
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

describe("readCloudflareAccessApplications", () => {
  it("reads every application", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ id: "app-1", name: "App" }], match: "/access/apps" }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAccessApplications({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["app-1"]);
  });

  it("refuses an application whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ name: "App" }], match: "/access/apps" }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccessApplications({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("schema");
    expect(unwrapErr(result).message).toBe(
      "cloudflare access-applications-list: response failed local schema validation: an item had no id in the access-applications-list response",
    );
  });
});

describe("readCloudflareAccessGroups", () => {
  it("reads every group", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ id: "grp-1", name: "Group" }], match: "/access/groups" }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAccessGroups({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["grp-1"]);
  });
});

describe("readCloudflareAccessServiceTokens", () => {
  it("reads every service token", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ id: "tok-1", name: "Token" }], match: "/access/service_tokens" }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAccessServiceTokens({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["tok-1"]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccessServiceTokens({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareIdentityProviders", () => {
  it("reads every identity provider", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({
        items: [{ id: "idp-1", name: "Okta", type: "okta" }],
        match: "/access/identity_providers",
      }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareIdentityProviders({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["idp-1"]);
  });
});
