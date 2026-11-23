import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareDevicePostureRules } from "../../../../../atlas/cloudflare/readers/devicePosture.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflareDevicePostureRules", () => {
  it("reads every rule from the single-page response", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { result: [{ id: "rule-1", name: "WARP" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDevicePostureRules({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["rule-1"]);
  });

  it("returns an empty list when there are no rules", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [], success: true }, status: 200 }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareDevicePostureRules({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("refuses a rule whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ name: "WARP" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const result = await readCloudflareDevicePostureRules({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("schema");
    expect(unwrapErr(result).message).toBe(
      "cloudflare device-posture-rules-list: response failed local schema validation: a device posture rule had no id in the response",
    );
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareDevicePostureRules({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
