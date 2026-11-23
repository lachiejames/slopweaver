import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflarePageRules } from "../../../../../atlas/cloudflare/readers/pageRule.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflarePageRules", () => {
  it("reads every Page Rule from the one-call response", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ id: "rule-1" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflarePageRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["rule-1"]);
  });

  it("skips a Page Rule whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ priority: 1 }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflarePageRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }))).toEqual(
      [],
    );
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflarePageRules({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
