import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareAccountSetting } from "../../../../../atlas/cloudflare/readers/accountSetting.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflareAccountSetting", () => {
  it("reads the account and keys the entity on the selected account id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { result: { id: ACCOUNT_ID, name: "Acme", type: "enterprise" }, success: true },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAccountSetting({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual([ACCOUNT_ID]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAccountSetting({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
