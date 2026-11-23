import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareWafOverrides,
  readCloudflareWafPackageChildren,
  readCloudflareWafPackageInventory,
} from "../../../../../atlas/cloudflare/readers/legacyWaf.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

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

describe("readCloudflareWafPackageInventory", () => {
  it("reads every package with a usable id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        return jsonResponse({ body: listPage({ items: [{ id: "pkg-1" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    const packages = unwrap(await readCloudflareWafPackageInventory({ client, zoneId: ZONE_ID }));
    expect(packages.map((pkg) => pkg.id)).toEqual(["pkg-1"]);
  });

  it("skips an item with no string id, since the SDK types this endpoint as bare unknown", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        return jsonResponse({ body: listPage({ items: [{ name: "no id here" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareWafPackageInventory({ client, zoneId: ZONE_ID }))).toEqual([]);
  });

  it("maps a 403 permission response to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { errors: [{ code: 1040, message: "WAF is deprecated for this zone" }], success: false },
          status: 403,
        }),
      maxRetries: 0,
    });
    const result = await readCloudflareWafPackageInventory({ client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareWafPackageChildren", () => {
  it("reads a package's combined groups and rules, tagged by which collection produced them", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        if (url.pathname.includes("/groups")) {
          return jsonResponse({ body: listPage({ items: [{ id: "g-1" }], page }), status: 200 });
        }
        return jsonResponse({ body: listPage({ items: [{ id: "r-1" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    const children = unwrap(await readCloudflareWafPackageChildren({ client, packageId: "pkg-1", zoneId: ZONE_ID }));
    expect(children).toEqual([
      { group: { id: "g-1" }, itemKind: "group" },
      { itemKind: "rule", rule: { id: "r-1" } },
    ]);
  });

  it("maps a groups-read failure to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareWafPackageChildren({ client, packageId: "pkg-1", zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareWafOverrides", () => {
  it("reads every override", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        return jsonResponse({ body: listPage({ items: [{ id: "o-1" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareWafOverrides({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["override:o-1"]);
  });

  it("maps a 410-gone response to the typed provider error", async () => {
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
    const result = await readCloudflareWafOverrides({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("provider");
  });
});
