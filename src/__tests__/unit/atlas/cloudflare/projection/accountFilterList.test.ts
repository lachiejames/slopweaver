import { describe, expect, it } from "vitest";

import {
  type CloudflareAccountFilterListDetail,
  isCloudflareAccountFilterListDetail,
  normalizeCloudflareAccountFilterListItem,
  projectCloudflareAccountFilterList,
} from "../../../../../atlas/cloudflare/projection/accountFilterList.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("normalizeCloudflareAccountFilterListItem", () => {
  it("strips id and comment, keeping the rest as config", () => {
    const item = normalizeCloudflareAccountFilterListItem({
      raw: { id: "item-1", comment: "prod redirect", source_url: "old.example.test", target_url: "new.example.test" },
    });
    expect(item).toEqual({
      comment: "prod redirect",
      config: { source_url: "old.example.test", target_url: "new.example.test" },
      id: "item-1",
    });
  });

  it("defaults a missing comment to null", () => {
    const item = normalizeCloudflareAccountFilterListItem({ raw: { id: "item-1", ip: "10.0.0.1" } });
    expect(item).toEqual({ comment: null, config: { ip: "10.0.0.1" }, id: "item-1" });
  });
});

describe("projectCloudflareAccountFilterList", () => {
  it("projects a list's metadata and items", () => {
    const entity = projectCloudflareAccountFilterList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [{ comment: null, config: { ip: "10.0.0.1" }, id: "item-1" }],
      raw: { id: "list-1", kind: "ip", name: "blocklist", num_items: 1, num_referencing_filters: 0 },
    });
    const detail = entity.detail as CloudflareAccountFilterListDetail;
    expect(detail.name).toBe("blocklist");
    expect(detail.listKind).toBe("ip");
    expect(detail.items).toHaveLength(1);
    expect(entity.providerId).toBe("list-1");
  });
});

describe("projectCloudflareAccountFilterList minimal row", () => {
  it("stores a null description when the SDK omits it, and keeps the one it sends", () => {
    const base = { id: "list-1", kind: "ip", name: "blocklist", num_items: 0, num_referencing_filters: 0 };
    const omitted = projectCloudflareAccountFilterList({ accountId: ACCOUNT_ID, at: AT, items: [], raw: base });
    const sent = projectCloudflareAccountFilterList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [],
      raw: { ...base, description: "blocks scanners" },
    });
    expect((omitted.detail as CloudflareAccountFilterListDetail).description).toBeNull();
    expect((sent.detail as CloudflareAccountFilterListDetail).description).toBe("blocks scanners");
  });
});

describe("isCloudflareAccountFilterListDetail", () => {
  it("accepts a genuine detail", () => {
    const entity = projectCloudflareAccountFilterList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [],
      raw: { id: "list-1", kind: "ip", name: "blocklist", num_items: 0, num_referencing_filters: 0 },
    });
    expect(isCloudflareAccountFilterListDetail(entity.detail)).toBe(true);
  });

  it("rejects a detail from a different kind", () => {
    expect(isCloudflareAccountFilterListDetail({ kind: "gateway-list" })).toBe(false);
  });

  it("rejects a non-object value", () => {
    expect(isCloudflareAccountFilterListDetail(42)).toBe(false);
  });
});
