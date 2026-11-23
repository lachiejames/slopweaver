import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareFirewallFilters,
  readCloudflareFirewallRules,
  readCloudflareIpAccessRules,
  readCloudflareLockdowns,
  readCloudflareRateLimits,
  readCloudflareUaRules,
} from "../../../../../atlas/cloudflare/readers/firewallService.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** One page of a V4-paginated list envelope, terminating with an empty page 2. */
function listPage({ page, items }: { page: number; items: readonly unknown[] }) {
  const result = page === 1 ? items : [];
  return { result, result_info: { count: result.length, page }, success: true };
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

function pagedClient({ items }: { items: readonly unknown[] }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const page = requestedPage({ url: requestUrl({ input }) });
      return jsonResponse({ body: listPage({ items, page }), status: 200 });
    },
    maxRetries: 0,
  });
}

function errorClient() {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
    maxRetries: 0,
  });
}

describe("readCloudflareFirewallFilters", () => {
  it("reads every filter, exhausting the cursor", async () => {
    const client = pagedClient({ items: [{ id: "f-1" }] });
    const entities = unwrap(
      await readCloudflareFirewallFilters({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["filter:f-1"]);
  });

  it("skips a filter whose response omits an id", async () => {
    const client = pagedClient({ items: [{ expression: "true" }] });
    expect(
      unwrap(await readCloudflareFirewallFilters({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID })),
    ).toEqual([]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareFirewallFilters({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient(),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareFirewallRules", () => {
  it("reads every rule", async () => {
    const client = pagedClient({ items: [{ id: "r-1" }] });
    const entities = unwrap(
      await readCloudflareFirewallRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["firewall-rule:r-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareFirewallRules({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient(),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareIpAccessRules", () => {
  it("reads every rule", async () => {
    const client = pagedClient({ items: [{ id: "a-1" }] });
    const entities = unwrap(
      await readCloudflareIpAccessRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["ip-access-rule:a-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareIpAccessRules({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient(),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareUaRules", () => {
  it("reads every rule", async () => {
    const client = pagedClient({ items: [{ id: "u-1" }] });
    const entities = unwrap(await readCloudflareUaRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["ua-rule:u-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareUaRules({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient(),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareLockdowns", () => {
  it("reads every lockdown", async () => {
    const client = pagedClient({ items: [{ id: "l-1" }] });
    const entities = unwrap(await readCloudflareLockdowns({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["lockdown:l-1"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareLockdowns({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient(),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareRateLimits", () => {
  it("reads every rate limit", async () => {
    const client = pagedClient({ items: [{ id: "rl-1" }] });
    const entities = unwrap(await readCloudflareRateLimits({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["rate-limit:rl-1"]);
  });

  it("maps a 410-gone response to the typed provider error, preserving the status", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: {
            errors: [{ message: "This API has been deprecated. Please use the Rulesets API instead." }],
            success: false,
          },
          status: 410,
        }),
      maxRetries: 0,
    });
    const result = await readCloudflareRateLimits({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    const error = unwrapErr(result);
    expect(error.kind).toBe("provider");
  });
});
