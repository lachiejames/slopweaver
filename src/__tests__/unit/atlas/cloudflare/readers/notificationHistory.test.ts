import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareNotificationHistory } from "../../../../../atlas/cloudflare/readers/notificationHistory.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

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

describe("readCloudflareNotificationHistory", () => {
  it("reads every history record, exhausting the cursor", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const result = page === 1 ? [{ id: "history-1", sent: "2026-01-01T00:00:00Z" }] : [];
        return jsonResponse({ body: { result, result_info: { page, total_pages: 1 }, success: true }, status: 200 });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareNotificationHistory({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["history-1"]);
  });

  it("skips a history record whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const result = page === 1 ? [{ sent: "2026-01-01T00:00:00Z" }] : [];
        return jsonResponse({ body: { result, result_info: { page, total_pages: 1 }, success: true }, status: 200 });
      },
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareNotificationHistory({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareNotificationHistory({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
