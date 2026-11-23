import { describe, expect, it } from "vitest";

import {
  callCloudflare,
  createCloudflareClient,
  createGuardingFetch,
  resolveLiveCloudflareScope,
} from "../../../../atlas/cloudflare/client.js";
import type { CloudflareSelectionInput } from "../../../../atlas/cloudflare/config.js";
import type { CloudflareClientError, CloudflareScopeError } from "../../../../atlas/cloudflare/errors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { requestedPage } from "./requestedPage.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ACCOUNT_ID = "fedcba9876543210fedcba9876543210";
const DEEP_ZONE_NAME = "example.test";

const SELECTION: CloudflareSelectionInput = { accountId: ACCOUNT_ID, deepZoneName: DEEP_ZONE_NAME };

/** Narrow a union error to its `"provider"` variant, throwing (not silently passing) on any other kind —
 * matches the `Extract<>` narrowing helper pattern in `src/__tests__/unit/live/slack/selection.test.ts`. */
function asProviderError(error: CloudflareClientError): Extract<CloudflareClientError, { kind: "provider" }> {
  if (error.kind !== "provider") {
    throw new Error(`expected a provider error, got ${error.kind}`);
  }
  return error;
}

/** Narrow a union error to its `"zone-ambiguous"` variant, throwing on any other kind. */
function asZoneAmbiguousError(
  error: CloudflareClientError | CloudflareScopeError,
): Extract<CloudflareScopeError, { kind: "zone-ambiguous" }> {
  if (error.kind !== "zone-ambiguous") {
    throw new Error(`expected a zone-ambiguous error, got ${error.kind}`);
  }
  return error;
}

/** The requested URL, however the SDK passed it — never `String(input)`, which would stringify a `Request`
 * via its default `Object` conversion rather than its actual URL. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/** A real `Response`, not a fake object — every characterization test here proves behavior against the
 * actual `Response`/`Cloudflare` classes, per `testing.md`'s "no mocks" rule. */
function jsonResponse({
  status,
  body,
  headers = {},
}: {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", ...headers }, status });
}

describe("createGuardingFetch", () => {
  it("passes through a non-JSON response unchanged", async () => {
    const guarded = createGuardingFetch({ fetchImpl: async () => new Response("plain text", { status: 200 }) });
    const response = await guarded("https://api.cloudflare.com/client/v4/zones");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("plain text");
  });

  it("passes through a genuine HTTP error unchanged", async () => {
    const guarded = createGuardingFetch({
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
    });
    const response = await guarded("https://api.cloudflare.com/client/v4/zones");
    expect(response.status).toBe(403);
  });

  it("passes through an HTTP-200 success:true response unchanged", async () => {
    const guarded = createGuardingFetch({
      fetchImpl: async () => jsonResponse({ body: { result: { id: ACCOUNT_ID }, success: true }, status: 200 }),
    });
    const response = await guarded("https://api.cloudflare.com/client/v4/accounts/x");
    expect(response.status).toBe(200);
  });

  it("converts an HTTP-200 success:false envelope into a non-retryable error response", async () => {
    const guarded = createGuardingFetch({
      fetchImpl: async () =>
        jsonResponse({ body: { errors: [{ message: "quota exceeded" }], success: false }, status: 200 }),
    });
    const response = await guarded("https://api.cloudflare.com/client/v4/accounts/x");
    expect(response.status).toBe(400);
    expect(response.headers.get("x-should-retry")).toBe("false");
    expect(response.headers.get("x-slopweaver-cloudflare-envelope-guard")).toBe("1");
    const body = (await response.json()) as { errors: { message: string }[] };
    expect(body.errors[0]?.message).toBe("quota exceeded");
  });

  it("catches an HTTP-200 success:false envelope even when the content-type casing is non-lowercase", async () => {
    const guarded = createGuardingFetch({
      fetchImpl: async () =>
        new Response(JSON.stringify({ errors: [{ message: "quota exceeded" }], success: false }), {
          headers: { "content-type": "Application/JSON" },
          status: 200,
        }),
    });
    const response = await guarded("https://api.cloudflare.com/client/v4/accounts/x");
    expect(response.status).toBe(400);
    expect(response.headers.get("x-slopweaver-cloudflare-envelope-guard")).toBe("1");
  });
});

describe("callCloudflare via createCloudflareClient", () => {
  it("resolves ok on a genuine success", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { result: { id: ACCOUNT_ID, name: "Test", type: "standard" }, success: true },
          status: 200,
        }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrap(result)).toEqual({ id: ACCOUNT_ID, name: "Test", type: "standard" });
  });

  it("maps a 401 to an authentication error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { errors: [{ message: "bad token" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });

  it("maps a 403 to a permission error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("permission");
  });

  it("maps a 404 to a not-found error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("not-found");
  });

  it("maps a 429 to a rate-limit error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { errors: [{ message: "slow down" }], success: false }, status: 429 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("rate-limit");
  });

  it("maps a 500 to a provider error carrying the real status", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "boom" }], success: false }, status: 500 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    const error = asProviderError(unwrapErr(result));
    expect(error.status).toBe(500);
  });

  it("maps an HTTP-200 success:false envelope to a response-envelope error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { errors: [{ message: "quota exceeded" }], success: false }, status: 200 }),
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("response-envelope");
  });

  it("maps a connection failure to a transport error, not a fake provider status", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      maxRetries: 0,
    });
    const result = await callCloudflare({
      call: () => client.accounts.get({ account_id: ACCOUNT_ID }),
      operation: "accounts.get",
    });
    expect(unwrapErr(result).kind).toBe("transport");
  });
});

/** One page of the `/zones` list envelope. `V4PagePaginationArray.hasNextPage()` requests another page for
 * ANY non-empty result regardless of `result_info`, so every fixture here MUST answer an empty array once
 * its zones are exhausted — otherwise the SDK's own auto-pagination loops forever against a fixture that
 * keeps repeating the same page. */
function zonesPage({
  zones,
  page,
}: {
  zones: readonly { id: string; name: string; accountId: string }[];
  page: number;
}) {
  return jsonResponse({
    body: {
      result: zones.map((zone) => ({ account: { id: zone.accountId, name: "Account" }, id: zone.id, name: zone.name })),
      result_info: { count: zones.length, page, per_page: 50, total_count: zones.length },
      success: true,
    },
    status: 200,
  });
}

/** A `fetch` stub that returns `zones` on page 1 and terminates pagination with an empty page 2. */
function singlePageZonesFetch({
  zones,
}: {
  zones: readonly { id: string; name: string; accountId: string }[];
}): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (url.pathname.includes("/accounts/")) {
      return accountResponse();
    }
    const page = requestedPage({ url });
    return page === 1 ? zonesPage({ page, zones }) : zonesPage({ page, zones: [] });
  };
}

function accountResponse(): Response {
  return jsonResponse({
    body: { result: { id: ACCOUNT_ID, name: "Test Account", type: "standard" }, success: true },
    status: 200,
  });
}

describe("resolveLiveCloudflareScope", () => {
  it("resolves the deep zone on the first page, case-insensitively", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePageZonesFetch({ zones: [{ accountId: ACCOUNT_ID, id: "zone-1", name: "Example.Test" }] }),
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrap(result)).toEqual({ accountId: ACCOUNT_ID, deepZone: { id: "zone-1", name: "Example.Test" } });
  });

  it("exhausts pagination before deciding — the match sits on the second page, terminated by an empty third", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.includes("/accounts/")) {
          return accountResponse();
        }
        const page = requestedPage({ url });
        if (page === 1) {
          return zonesPage({ page: 1, zones: [{ accountId: ACCOUNT_ID, id: "zone-other", name: "other.test" }] });
        }
        if (page === 2) {
          return zonesPage({ page: 2, zones: [{ accountId: ACCOUNT_ID, id: "zone-1", name: DEEP_ZONE_NAME }] });
        }
        return zonesPage({ page, zones: [] });
      },
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrap(result)).toEqual({ accountId: ACCOUNT_ID, deepZone: { id: "zone-1", name: DEEP_ZONE_NAME } });
  });

  it("refuses when zero zones match the configured deep zone name", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePageZonesFetch({ zones: [{ accountId: ACCOUNT_ID, id: "zone-other", name: "other.test" }] }),
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrapErr(result).kind).toBe("zone-not-found");
  });

  it("refuses when more than one zone matches the configured deep zone name", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePageZonesFetch({
        zones: [
          { accountId: ACCOUNT_ID, id: "zone-1", name: DEEP_ZONE_NAME },
          { accountId: ACCOUNT_ID, id: "zone-2", name: DEEP_ZONE_NAME },
        ],
      }),
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    const error = asZoneAmbiguousError(unwrapErr(result));
    expect(error.matchCount).toBe(2);
  });

  it("refuses a matched zone whose response omits an id, rather than returning it as undefined", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.includes("/accounts/")) {
          return accountResponse();
        }
        const page = requestedPage({ url });
        if (page !== 1) {
          return jsonResponse({ body: { result: [], result_info: { count: 0 }, success: true }, status: 200 });
        }
        return jsonResponse({
          body: {
            result: [{ account: { id: ACCOUNT_ID, name: "Account" }, name: DEEP_ZONE_NAME }],
            result_info: { count: 1 },
            success: true,
          },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrapErr(result).kind).toBe("schema");
  });

  it("refuses a matched zone that belongs to a different account than configured", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePageZonesFetch({ zones: [{ accountId: OTHER_ACCOUNT_ID, id: "zone-1", name: DEEP_ZONE_NAME }] }),
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrapErr(result).kind).toBe("zone-account-mismatch");
  });

  it("never lists zones when the account itself is unreachable", async () => {
    let zonesCalled = false;
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.includes("/accounts/")) {
          return jsonResponse({ body: { errors: [{ message: "bad token" }], success: false }, status: 401 });
        }
        zonesCalled = true;
        return zonesPage({ page: 1, zones: [] });
      },
      maxRetries: 0,
    });
    const result = await resolveLiveCloudflareScope({ client, selection: SELECTION });
    expect(unwrapErr(result).kind).toBe("authentication");
    expect(zonesCalled).toBe(false);
  });
});
