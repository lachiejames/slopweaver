import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareDnsRecords } from "../../../../../atlas/cloudflare/readers/dnsRecord.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** One page of a V4-paginated list envelope, terminating with an empty page 2 — see `readers/zone.ts`'s own
 * header for why a fixture that never empties will pagination-loop the real SDK. */
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

describe("readCloudflareDnsRecords", () => {
  it("reads every DNS record, exhausting the cursor", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        return jsonResponse({ body: listPage({ items: [{ id: "record-1", type: "A" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareDnsRecords({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }));
    expect(entities.map((entity) => entity.providerId)).toEqual(["record-1"]);
  });

  it("skips a record whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const page = requestedPage({ url: requestUrl({ input }) });
        return jsonResponse({ body: listPage({ items: [{ type: "A" }], page }), status: 200 });
      },
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareDnsRecords({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }))).toEqual(
      [],
    );
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareDnsRecords({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
