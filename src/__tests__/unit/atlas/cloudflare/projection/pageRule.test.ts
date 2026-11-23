import { describe, expect, it } from "vitest";

import { projectCloudflarePageRule } from "../../../../../atlas/cloudflare/projection/pageRule.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflarePageRule", () => {
  it("projects every field and keeps actions/targets as open records", () => {
    const entity = projectCloudflarePageRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        actions: [{ id: "forwarding_url", value: { status_code: 301, url: "https://example.test" } }],
        created_on: "2026-01-01T00:00:00Z",
        id: "rule-1",
        modified_on: "2026-01-02T00:00:00Z",
        priority: 1,
        status: "active",
        targets: [{ constraint: { operator: "matches", value: "example.test/*" }, target: "url" }],
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("rule-1");
    expect(entity.detail).toEqual({
      actions: [{ id: "forwarding_url", value: { status_code: 301, url: "https://example.test" } }],
      createdOn: "2026-01-01T00:00:00Z",
      kind: "page-rule",
      modifiedOn: "2026-01-02T00:00:00Z",
      priority: 1,
      status: "active",
      targets: [{ constraint: { operator: "matches", value: "example.test/*" }, target: "url" }],
    });
  });

  it("copies each action and target and drops an entry that is not a record", () => {
    const action = { id: "always_online", value: "on" };
    const target = { target: "url" };
    const entity = projectCloudflarePageRule({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { actions: [action, "stray"], id: "rule-1", targets: [target, 7] },
      zoneId: ZONE_ID,
    });
    const detail = entity.detail as { actions: unknown[]; targets: unknown[] };
    expect(detail.actions).toEqual([action]);
    expect(detail.actions[0]).not.toBe(action);
    expect(detail.targets).toEqual([target]);
    expect(detail.targets[0]).not.toBe(target);
  });

  it("defaults every missing field to null or an empty list", () => {
    const entity = projectCloudflarePageRule({ accountId: ACCOUNT_ID, at: AT, raw: { id: "rule-1" }, zoneId: ZONE_ID });
    expect(entity.detail).toEqual({
      actions: [],
      createdOn: null,
      kind: "page-rule",
      modifiedOn: null,
      priority: null,
      status: null,
      targets: [],
    });
  });
});
