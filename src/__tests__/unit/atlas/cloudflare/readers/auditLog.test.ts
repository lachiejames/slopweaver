import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareAuditLogs } from "../../../../../atlas/cloudflare/readers/auditLog.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-31T00:00:00.000Z";
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

describe("readCloudflareAuditLogs", () => {
  it("queries a 30-day since/before window ending at `at`, and reads every entry", async () => {
    let capturedSince: string | null = null;
    let capturedBefore: string | null = null;
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        const page = requestedPage({ url });
        capturedSince = url.searchParams.get("since");
        capturedBefore = url.searchParams.get("before");
        const items = page === 1 ? [{ id: "log-1" }, { id: "log-2" }] : [];
        return jsonResponse({
          body: { result: items, result_info: { count: items.length, page }, success: true },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareAuditLogs({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["log-1", "log-2"]);
    expect(capturedBefore).toBe("2026-01-31T00:00:00.000Z");
    expect(capturedSince).toBe("2026-01-01T00:00:00.000Z");
  });

  it("skips a log entry whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        const items = page === 1 ? [{ when: "2026-01-15T00:00:00Z" }] : [];
        return jsonResponse({
          body: { result: items, result_info: { count: items.length, page }, success: true },
          status: 200,
        });
      },
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareAuditLogs({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareAuditLogs({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
