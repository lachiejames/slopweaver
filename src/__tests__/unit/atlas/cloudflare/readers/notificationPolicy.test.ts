import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareNotificationPolicies } from "../../../../../atlas/cloudflare/readers/notificationPolicy.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflareNotificationPolicies", () => {
  it("reads every policy from the single-page response", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { result: [{ id: "policy-1", name: "SSL alerts" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareNotificationPolicies({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["policy-1"]);
  });

  it("skips a policy whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ name: "SSL alerts" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareNotificationPolicies({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareNotificationPolicies({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
