import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import type { CloudflareDevicePolicyDetail } from "../../../../../atlas/cloudflare/projection/zeroTrustDevice.js";
import { readCloudflareAccessUsers } from "../../../../../atlas/cloudflare/readers/zeroTrustActor.js";
import { readCloudflareDlpProfiles } from "../../../../../atlas/cloudflare/readers/zeroTrustData.js";
import {
  readCloudflareDevicePolicies,
  readCloudflareDeviceSetting,
} from "../../../../../atlas/cloudflare/readers/zeroTrustDevice.js";
import {
  readCloudflareGatewayCertificates,
  readCloudflareGatewayConfiguration,
  readCloudflareGatewayPolicies,
} from "../../../../../atlas/cloudflare/readers/zeroTrustGateway.js";
import {
  readCloudflareTunnelRoutes,
  readCloudflareTunnels,
} from "../../../../../atlas/cloudflare/readers/zeroTrustNetwork.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/**
 * A client answering every request with one fixed body — and, for a V4-paginated surface, an EMPTY page 2.
 *
 * The empty second page is not decoration. Several of these surfaces are `V4PagePaginationArray`, so a stub
 * that returns the same non-empty page for every request makes `for await` iterate forever; the first
 * version of this file did exactly that and killed the vitest worker with a heap OOM rather than failing a
 * test. Reproduce by deleting the `page` branch below and running this file.
 */
function fixedClient({ body, status = 200 }: { body: unknown; status?: number }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const page = requestedPage({ url: requestUrl({ input }) });
      if (page > 1) {
        return jsonResponse({ body: { result: [], result_info: { count: 0, page }, success: true }, status: 200 });
      }
      return jsonResponse({ body, status });
    },
    maxRetries: 0,
  });
}

describe("readCloudflareGatewayPolicies", () => {
  it("reads every policy in the response", async () => {
    const client = fixedClient({ body: { result: [{ id: "rule-1", name: "block" }], success: true } });
    const entities = unwrap(await readCloudflareGatewayPolicies({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["rule-1"]);
  });

  it("refuses a policy whose response omits an id", async () => {
    const client = fixedClient({ body: { result: [{ name: "block" }], success: true } });
    const result = await readCloudflareGatewayPolicies({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("schema");
  });

  it("maps a permission refusal to the typed client error", async () => {
    const client = fixedClient({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
    const result = await readCloudflareGatewayPolicies({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("an id-less row in a Zero Trust collection", () => {
  it("refuses a Gateway certificate whose response omits an id, naming the missing id and nothing invented", async () => {
    const client = fixedClient({ body: { result: [{ fingerprint: "ab:cd" }], success: true } });
    const result = await readCloudflareGatewayCertificates({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).message).toBe(
      "cloudflare gateway-certificates-list: response failed local schema validation: a Gateway certificate had no id in the response",
    );
  });

  it("refuses a tunnel route whose response omits an id, naming the missing id and nothing invented", async () => {
    const client = fixedClient({ body: { result: [{ network: "10.0.0.0/8" }], success: true } });
    const result = await readCloudflareTunnelRoutes({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).message).toBe(
      "cloudflare tunnel-routes-list: response failed local schema validation: a tunnel route had no id in the response",
    );
  });
});

describe("a Zero Trust singleton reader", () => {
  it("projects one entity when the singleton is present", async () => {
    const client = fixedClient({ body: { result: { settings: { antivirus: null } }, success: true } });
    const entities = unwrap(await readCloudflareGatewayConfiguration({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.kind)).toEqual(["gateway-configuration"]);
  });

  it("returns NO entity for a null singleton rather than inventing an all-null record", async () => {
    const client = fixedClient({ body: { result: null, success: true } });
    expect(unwrap(await readCloudflareGatewayConfiguration({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("maps a failed singleton read to the typed client error", async () => {
    const client = fixedClient({ body: { errors: [{ message: "nope" }], success: false }, status: 401 });
    const result = await readCloudflareDeviceSetting({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareDevicePolicies", () => {
  it("folds the default profile and the custom list into one kind, flagged apart", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        if (url.pathname.endsWith("/devices/policy")) {
          return jsonResponse({
            body: { result: { default: true, policy_id: "warp-default" }, success: true },
            status: 200,
          });
        }
        return jsonResponse({
          body: {
            result: page === 1 ? [{ name: "contractors", policy_id: "warp-custom-1" }] : [],
            result_info: { count: page === 1 ? 1 : 0, page },
            success: true,
          },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDevicePolicies({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["warp-default", "warp-custom-1"]);
    expect(entities.map((entity) => (entity.detail as CloudflareDevicePolicyDetail).isDefault)).toEqual([true, false]);
  });

  it("emits the default profile ONCE when the custom list carries it too", async () => {
    // MEASURED live: `devices/policies` returns the default profile
    // alongside the custom ones. Emitting both produced one entity id twice and `merge.ts` refused the
    // whole generation for it. Delete the `seen` guard in the reader and this test fails with two
    // `warp-default` rows — which is the shape the store rejects.
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        if (url.pathname.endsWith("/devices/policy")) {
          return jsonResponse({
            body: { result: { default: true, policy_id: "warp-default" }, success: true },
            status: 200,
          });
        }
        return jsonResponse({
          body: {
            result:
              page === 1
                ? [
                    { default: true, name: "Default", policy_id: "warp-default" },
                    { name: "contractors", policy_id: "warp-custom-1" },
                  ]
                : [],
            result_info: { count: page === 1 ? 2 : 0, page },
            success: true,
          },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDevicePolicies({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["warp-default", "warp-custom-1"]);
    expect(new Set(entities.map((entity) => entity.id)).size).toBe(2);
    expect(entities.map((entity) => (entity.detail as CloudflareDevicePolicyDetail).isDefault)).toEqual([true, false]);
  });

  it("returns the failure rather than a partial answer when the default profile read fails", async () => {
    const client = fixedClient({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
    const result = await readCloudflareDevicePolicies({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });

  it("holds only the custom list when the account has no default profile record", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        if (url.pathname.endsWith("/devices/policy")) {
          return jsonResponse({ body: { result: null, success: true }, status: 200 });
        }
        return jsonResponse({
          body: {
            result: page === 1 ? [{ policy_id: "warp-custom-1" }] : [],
            result_info: { count: page === 1 ? 1 : 0, page },
            success: true,
          },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDevicePolicies({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["warp-custom-1"]);
  });
});

describe("readCloudflareAccessUsers", () => {
  it("reads every user in the response", async () => {
    const client = fixedClient({
      body: { result: [{ email: "person@example.test", id: "user-1" }], success: true },
    });
    const entities = unwrap(await readCloudflareAccessUsers({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["user-1"]);
  });
});

describe("readCloudflareTunnels", () => {
  it("returns an empty list when the account runs no tunnels", async () => {
    const client = fixedClient({ body: { result: [], success: true } });
    expect(unwrap(await readCloudflareTunnels({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });
});

describe("readCloudflareDlpProfiles", () => {
  it("refuses a profile whose response omits an id", async () => {
    const client = fixedClient({ body: { result: [{ name: "payment data" }], success: true } });
    const result = await readCloudflareDlpProfiles({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("schema");
  });
});
