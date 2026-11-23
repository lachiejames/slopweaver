import { describe, expect, it } from "vitest";

import { absentAsEmpty } from "#lib/absent.js";
import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { type CloudflareEntity, emptyCloudflareKindFile } from "../../../../atlas/cloudflare/model.js";
import {
  isCloudflareRulesetDetail,
  projectCloudflareRuleset,
} from "../../../../atlas/cloudflare/projection/ruleset.js";
import { syncRulesetKind, syncZoneRulesetKind } from "../../../../atlas/cloudflare/rulesetSync.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedPage } from "./requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
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

/**
 * A client serving the ruleset inventory and one `get` per ruleset, with any ruleset named in
 * `failGets` answering 403 — the shape a live zone actually presents, where one zone ruleset can refuse
 * its own `get` while its siblings read.
 */
function rulesetClient({
  rulesets,
  rulesById,
  failGets = [],
}: {
  rulesets: readonly { id: string; name?: string; phase?: string }[];
  rulesById: Record<string, readonly unknown[]>;
  failGets?: readonly string[];
}) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const page = requestedPage({ url });
      const detail = rulesets.find((ruleset) => url.pathname.endsWith(`/rulesets/${ruleset.id}`));
      if (detail !== undefined) {
        if (failGets.includes(detail.id)) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return jsonResponse({
          body: { result: { ...detail, rules: absentAsEmpty({ value: rulesById[detail.id] }) }, success: true },
          status: 200,
        });
      }
      const items = page === 1 ? rulesets : [];
      return jsonResponse({
        body: { result: items, result_info: { count: items.length, page }, success: true },
        status: 200,
      });
    },
    maxRetries: 0,
  });
}

/** The rules a stored entity carries, or an empty list when its detail is not a ruleset detail. */
function storedRules({ entity }: { entity: CloudflareEntity }): readonly unknown[] {
  return isCloudflareRulesetDetail(entity.detail) ? entity.detail.rules : [];
}

describe("projectCloudflareRuleset", () => {
  it("stores null for every metadata field a ruleset that carries only its id omits", () => {
    const entity = projectCloudflareRuleset({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "rs-1" },
      rules: [],
      zoneId: null,
    });
    expect(entity.detail).toEqual({
      description: null,
      kind: "ruleset",
      lastUpdated: null,
      name: null,
      phase: null,
      rules: [],
      rulesetKind: null,
      source: null,
      version: null,
    });
  });

  it("stores null for a metadata field the provider sent as null", () => {
    const entity = projectCloudflareRuleset({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        description: null,
        id: "rs-1",
        kind: null,
        last_updated: null,
        name: null,
        phase: null,
        source: null,
        version: null,
      },
      rules: [],
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      description: null,
      kind: "zone-ruleset",
      lastUpdated: null,
      name: null,
      phase: null,
      rules: [],
      rulesetKind: null,
      source: null,
      version: null,
    });
  });

  it("keys an account ruleset without a zone and a zone ruleset with one, so the two id spaces never collide", () => {
    const raw = { id: "rs-1", name: "custom", phase: "http_request_firewall_custom" };
    const account = projectCloudflareRuleset({ accountId: ACCOUNT_ID, at: AT, raw, rules: [], zoneId: null });
    const zone = projectCloudflareRuleset({ accountId: ACCOUNT_ID, at: AT, raw, rules: [], zoneId: ZONE_ID });
    expect(account.kind).toBe("ruleset");
    expect(zone.kind).toBe("zone-ruleset");
    expect(account.scope.zoneId).toBeNull();
    expect(zone.scope.zoneId).toBe(ZONE_ID);
    expect(account.id === zone.id).toBe(false);
  });

  it("carries the phase, which is what makes managed WAF and Cache Rules the SAME surface as this one", () => {
    const entity = projectCloudflareRuleset({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "rs-1", kind: "managed", phase: "http_request_firewall_managed" },
      rules: [{ action: "block" }],
      zoneId: null,
    });
    expect(isCloudflareRulesetDetail(entity.detail)).toBe(true);
    expect(storedRules({ entity })).toEqual([{ action: "block" }]);
  });
});

describe("syncRulesetKind", () => {
  it("holds the RULES each ruleset contains, which the inventory read never returns", async () => {
    const client = rulesetClient({
      rulesById: { "rs-1": [{ action: "block", id: "rule-a" }], "rs-2": [] },
      rulesets: [
        { id: "rs-1", name: "custom", phase: "http_request_firewall_custom" },
        { id: "rs-2", name: "cache", phase: "http_request_cache_settings" },
      ],
    });
    const stored = emptyCloudflareKindFile({ kind: "ruleset", updatedAt: AT });
    const folded = unwrap(await syncRulesetKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "ruleset", reasons: [] });
    // Keyed rather than positional: `reconcileParentFanout` sorts by the hashed entity id, so the stored
    // order is stable but is not the inventory order.
    expect(
      Object.fromEntries(folded.file.entities.map((entity) => [entity.providerId, storedRules({ entity }).length])),
    ).toEqual({ "rs-1": 1, "rs-2": 0 });
    expect(folded.file.coverage.map((cell) => cell.state)).toEqual(["synced"]);
  });

  it("costs one ruleset's rules, not the kind's whole read, when that ruleset's get is refused", async () => {
    const client = rulesetClient({
      failGets: ["rs-2"],
      rulesById: { "rs-1": [{ id: "rule-a" }] },
      rulesets: [{ id: "rs-1" }, { id: "rs-2" }],
    });
    const stored = emptyCloudflareKindFile({ kind: "ruleset", updatedAt: AT });
    const folded = unwrap(await syncRulesetKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));
    expect(folded.outcome.complete).toBe(false);
    expect(folded.file.entities.map((entity) => entity.providerId).toSorted()).toEqual(["rs-1", "rs-2"]);
    expect(folded.file.gaps.map((gap) => gap.condition)).toEqual(["permission-refused"]);
    expect(folded.file.gaps.map((gap) => gap.status)).toEqual(["open"]);
  });

  it("folds a failed inventory read into an unreadable cell rather than throwing", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const stored = emptyCloudflareKindFile({ kind: "ruleset", updatedAt: AT });
    const folded = unwrap(await syncRulesetKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));
    expect(folded.outcome.complete).toBe(false);
    expect(folded.file.coverage.map((cell) => cell.state)).toEqual(["unreadable"]);
  });
});

describe("syncZoneRulesetKind", () => {
  it("stamps the deep zone on every entity it reads", async () => {
    const client = rulesetClient({ rulesById: { "rs-1": [] }, rulesets: [{ id: "rs-1", name: "zone custom" }] });
    const stored = emptyCloudflareKindFile({ kind: "zone-ruleset", updatedAt: AT });
    const folded = unwrap(
      await syncZoneRulesetKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );
    expect(folded.file.entities.map((entity) => entity.scope.zoneId)).toEqual([ZONE_ID]);
  });

  it("leaves every OTHER zone's stored rulesets untouched — a deep-zone read may not delete them", async () => {
    const other = projectCloudflareRuleset({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "rs-other" },
      rules: [],
      zoneId: "zone-2",
    });
    const stored = { ...emptyCloudflareKindFile({ kind: "zone-ruleset", updatedAt: AT }), entities: [other] };
    const client = rulesetClient({ rulesById: { "rs-1": [] }, rulesets: [{ id: "rs-1" }] });
    const folded = unwrap(
      await syncZoneRulesetKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );
    expect(folded.file.entities.map((entity) => entity.scope.zoneId)).toEqual(["zone-2", ZONE_ID]);
  });
});
