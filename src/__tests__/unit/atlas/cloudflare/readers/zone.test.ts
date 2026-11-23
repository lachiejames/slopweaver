import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareZones } from "../../../../../atlas/cloudflare/readers/zone.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it — never `String(input)`, which would stringify a `Request`
 * via its default `Object` conversion rather than its actual URL. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

type FixtureZone = { id: string; name: string; account: { id: string } };

/** The zones the case placed on one page. A page past the last one it described is the empty page that ends
 * the walk — the provider's own terminator, not a missing fixture. */
function zonesOnPage({
  pages,
  page,
}: {
  pages: readonly (readonly FixtureZone[])[];
  page: number;
}): readonly FixtureZone[] {
  const zones = pages[page - 1];
  if (zones === undefined) {
    return [];
  }
  return zones;
}

/** A `fetch` stub returning `zones` on page 1 and terminating with an empty page 2 — see
 * `client.test.ts`'s own header comment on why every zones fixture must do this. */
function pagedZonesFetch({ pages }: { pages: readonly (readonly FixtureZone[])[] }): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    const page = requestedPage({ url });
    const zones = zonesOnPage({ pages, page });
    return jsonResponse({
      body: { result: zones, result_info: { count: zones.length, page }, success: true },
      status: 200,
    });
  };
}

describe("readCloudflareZones", () => {
  it("reads every zone across a single page", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: pagedZonesFetch({
        pages: [[{ account: { id: ACCOUNT_ID }, id: "z1", name: "one.test" }]],
      }),
      maxRetries: 0,
    });
    const result = await readCloudflareZones({ accountId: ACCOUNT_ID, at: AT, client });
    const entities = unwrap(result);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.providerId).toBe("z1");
  });

  it("exhausts pagination across multiple pages", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: pagedZonesFetch({
        pages: [
          [{ account: { id: ACCOUNT_ID }, id: "z1", name: "one.test" }],
          [{ account: { id: ACCOUNT_ID }, id: "z2", name: "two.test" }],
        ],
      }),
      maxRetries: 0,
    });
    const result = await readCloudflareZones({ accountId: ACCOUNT_ID, at: AT, client });
    const entities = unwrap(result);
    expect(entities.map((entity) => entity.providerId)).toEqual(["z1", "z2"]);
  });

  it("refuses a zone whose response omits an id, rather than projecting it as undefined", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: pagedZonesFetch({
        // `id` omitted on purpose — the fixture's own type says every zone has one, so a raw object
        // literal that skips it is exactly the runtime deviation this reader must refuse.
        pages: [
          [
            { account: { id: ACCOUNT_ID }, name: "one.test" } as unknown as {
              id: string;
              name: string;
              account: { id: string };
            },
          ],
        ],
      }),
      maxRetries: 0,
    });
    const result = await readCloudflareZones({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("schema");
  });

  it("maps an HTTP error mid-pagination to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareZones({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });

  it("returns an empty list when the account has no zones", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: pagedZonesFetch({ pages: [] }),
      maxRetries: 0,
    });
    const result = await readCloudflareZones({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrap(result)).toEqual([]);
  });
});
