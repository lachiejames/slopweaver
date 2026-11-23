import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { CloudflareClientErrors } from "../../../../../atlas/cloudflare/errors.js";
import {
  readCloudflareRulesetInventory,
  readCloudflareRulesetRules,
} from "../../../../../atlas/cloudflare/readers/ruleset.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedCursor } from "../requestedPage.js";

const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "zone-1";

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

/** Which ruleset a request's cursor points at: the first request carries no cursor and asks for the first. */
function rulesetIndex({ url }: { url: URL }): number {
  const carried = requestedCursor({ url });
  if (carried === null) {
    return 0;
  }
  return Number(carried);
}

/**
 * A client serving the ruleset inventory one ruleset per CURSOR page — the SDK's `rulesets.list` follows
 * `result_info.cursor` until a page carries none — and one `get` per ruleset; a `status` other than 200
 * refuses every request. Every request's path and cursor is recorded in order.
 */
function rulesetClient({
  rulesets,
  rules = [],
  status = 200,
}: {
  rulesets: readonly Record<string, unknown>[];
  rules?: readonly unknown[];
  status?: number;
}) {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const index = rulesetIndex({ url });
      requests.push(`${url.pathname}@${String(index)}`);
      if (status !== 200) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status });
      }
      if (url.pathname.endsWith("/rulesets")) {
        const next = index + 1 < rulesets.length ? { cursor: String(index + 1) } : {};
        return jsonResponse({
          body: { result: rulesets.slice(index, index + 1), result_info: next, success: true },
          status: 200,
        });
      }
      return jsonResponse({ body: { result: { id: "rs-1", rules }, success: true }, status: 200 });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

describe("readCloudflareRulesetInventory", () => {
  const rulesets = [
    { id: "rs-1", kind: "custom", name: "first", phase: "http_request_firewall_custom" },
    { id: "rs-2", kind: "managed", name: "second", phase: "http_request_cache_settings" },
  ];

  it("reads an account's inventory to its last page, in page order", async () => {
    const served = rulesetClient({ rulesets });
    const read = await readCloudflareRulesetInventory({
      client: served.client,
      operation: "rulesets-list",
      params: { account_id: ACCOUNT_ID },
    });
    expect(unwrap(read)).toEqual(rulesets);
    expect(served.requests).toEqual([
      `/client/v4/accounts/${ACCOUNT_ID}/rulesets@0`,
      `/client/v4/accounts/${ACCOUNT_ID}/rulesets@1`,
    ]);
  });

  it("reads a zone's inventory at the zone's own path, never the account's", async () => {
    const served = rulesetClient({ rulesets });
    const read = await readCloudflareRulesetInventory({
      client: served.client,
      operation: "zone-rulesets-list",
      params: { zone_id: ZONE_ID },
    });
    expect(unwrap(read)).toEqual(rulesets);
    expect(served.requests).toEqual([
      `/client/v4/zones/${ZONE_ID}/rulesets@0`,
      `/client/v4/zones/${ZONE_ID}/rulesets@1`,
    ]);
  });

  it("names the caller's operation on a refusal, so an account and a zone read are told apart", async () => {
    const served = rulesetClient({ rulesets, status: 403 });
    const failure = unwrapErr(
      await readCloudflareRulesetInventory({
        client: served.client,
        operation: "zone-rulesets-list",
        params: { zone_id: ZONE_ID },
      }),
    );
    expect([failure.kind, failure.operation]).toEqual(["permission", "zone-rulesets-list"]);
    expect(failure.message).toContain("cloudflare zone-rulesets-list: permission denied (403)");
  });

  it.each([
    ["no id", { name: "nameless", phase: "http_request_firewall_custom" }],
    ["an empty id", { id: "", name: "nameless", phase: "http_request_firewall_custom" }],
  ])("refuses an inventory row with %s, naming the ruleset and the operation", async (_label, row) => {
    const served = rulesetClient({ rulesets: [row] });
    const read = await readCloudflareRulesetInventory({
      client: served.client,
      operation: "rulesets-list",
      params: { account_id: ACCOUNT_ID },
    });
    expect(unwrapErr(read)).toEqual(
      CloudflareClientErrors.schema({
        cause: 'a ruleset named "nameless" had no id in the response',
        operation: "rulesets-list",
      }),
    );
  });
});

describe("readCloudflareRulesetRules", () => {
  const rules = [
    { action: "block", expression: "ip.src eq 192.0.2.1", id: "rule-a" },
    { action: "skip", expression: "true", id: "rule-b" },
  ];

  it("reads one account ruleset's rules from its own get", async () => {
    const served = rulesetClient({ rules, rulesets: [] });
    const read = await readCloudflareRulesetRules({
      client: served.client,
      operation: "rulesets-get",
      params: { account_id: ACCOUNT_ID },
      rulesetId: "rs-1",
    });
    expect(unwrap(read)).toEqual(rules);
    expect(served.requests).toEqual([`/client/v4/accounts/${ACCOUNT_ID}/rulesets/rs-1@0`]);
  });

  it("reads one zone ruleset's rules at the zone's path", async () => {
    const served = rulesetClient({ rules, rulesets: [] });
    const read = await readCloudflareRulesetRules({
      client: served.client,
      operation: "zone-rulesets-get",
      params: { zone_id: ZONE_ID },
      rulesetId: "rs-1",
    });
    expect(unwrap(read)).toEqual(rules);
    expect(served.requests).toEqual([`/client/v4/zones/${ZONE_ID}/rulesets/rs-1@0`]);
  });

  it("names the caller's operation when the get is refused", async () => {
    const served = rulesetClient({ rulesets: [], status: 403 });
    const failure = unwrapErr(
      await readCloudflareRulesetRules({
        client: served.client,
        operation: "zone-rulesets-get",
        params: { zone_id: ZONE_ID },
        rulesetId: "rs-1",
      }),
    );
    expect([failure.kind, failure.operation]).toEqual(["permission", "zone-rulesets-get"]);
    expect(failure.message).toContain("cloudflare zone-rulesets-get: permission denied (403)");
  });
});
