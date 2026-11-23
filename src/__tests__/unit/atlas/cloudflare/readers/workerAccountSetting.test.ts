import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareWorkerAccountSetting } from "../../../../../atlas/cloudflare/readers/workerAccountSetting.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

describe("readCloudflareWorkerAccountSetting", () => {
  it("combines the account settings and subdomain reads into one entity", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/workers/account-settings")) {
          return jsonResponse({ body: { result: { default_usage_model: "standard" }, success: true }, status: 200 });
        }
        if (url.pathname.endsWith("/workers/subdomain")) {
          return jsonResponse({ body: { result: { subdomain: "my-team" }, success: true }, status: 200 });
        }
        return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareWorkerAccountSetting({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities).toHaveLength(1);
    expect(entities[0]?.detail).toMatchObject({ defaultUsageModel: "standard", subdomain: "my-team" });
  });

  it("maps a permission error from the account-settings read to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareWorkerAccountSetting({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });

  it("maps a not-found error from the subdomain read to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/workers/account-settings")) {
          return jsonResponse({ body: { result: {}, success: true }, status: 200 });
        }
        return jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 });
      },
      maxRetries: 0,
    });
    const result = await readCloudflareWorkerAccountSetting({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});
