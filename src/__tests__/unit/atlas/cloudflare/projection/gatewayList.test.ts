import { describe, expect, it } from "vitest";

import {
  type CloudflareGatewayListDetail,
  isCloudflareGatewayListDetail,
  normalizeCloudflareGatewayListItem,
  projectCloudflareGatewayList,
} from "../../../../../atlas/cloudflare/projection/gatewayList.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("normalizeCloudflareGatewayListItem", () => {
  it("defaults a missing value and description to null", () => {
    expect(normalizeCloudflareGatewayListItem({ raw: {} })).toEqual({ description: null, value: null });
  });

  it("keeps a present value and description", () => {
    expect(normalizeCloudflareGatewayListItem({ raw: { description: "admin box", value: "10.0.0.1" } })).toEqual({
      description: "admin box",
      value: "10.0.0.1",
    });
  });
});

describe("projectCloudflareGatewayList", () => {
  it("stores a null name, type, description and declared count for a list that carries only its id", () => {
    const entity = projectCloudflareGatewayList({ accountId: ACCOUNT_ID, at: AT, items: [], raw: { id: "list-1" } });
    expect(entity.detail).toEqual({
      declaredCount: null,
      description: null,
      items: [],
      itemsComplete: true,
      kind: "gateway-list",
      name: null,
      type: null,
    });
  });

  it("marks items complete when the count matches the declared count", () => {
    const entity = projectCloudflareGatewayList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [{ description: null, value: "10.0.0.1" }],
      raw: { count: 1, id: "list-1", name: "IPs" },
    });
    const detail = entity.detail as CloudflareGatewayListDetail;
    expect(detail.itemsComplete).toBe(true);
    expect(detail.declaredCount).toBe(1);
  });

  it("marks items incomplete when the count falls short of the declared count", () => {
    const entity = projectCloudflareGatewayList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [{ description: null, value: "10.0.0.1" }],
      raw: { count: 5, id: "list-1", name: "IPs" },
    });
    const detail = entity.detail as CloudflareGatewayListDetail;
    expect(detail.itemsComplete).toBe(false);
  });

  it("treats a missing declared count as complete only when there are no items", () => {
    const empty = projectCloudflareGatewayList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [],
      raw: { id: "list-1", name: "IPs" },
    });
    const nonEmpty = projectCloudflareGatewayList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [{ description: null, value: "10.0.0.1" }],
      raw: { id: "list-1", name: "IPs" },
    });
    expect((empty.detail as CloudflareGatewayListDetail).itemsComplete).toBe(true);
    expect((nonEmpty.detail as CloudflareGatewayListDetail).itemsComplete).toBe(false);
  });
});

describe("isCloudflareGatewayListDetail", () => {
  it("accepts a genuine detail", () => {
    const entity = projectCloudflareGatewayList({
      accountId: ACCOUNT_ID,
      at: AT,
      items: [],
      raw: { count: 0, id: "list-1", name: "IPs" },
    });
    expect(isCloudflareGatewayListDetail(entity.detail)).toBe(true);
  });

  it("rejects a detail from a different kind", () => {
    expect(isCloudflareGatewayListDetail({ kind: "zone" })).toBe(false);
  });

  it("rejects a non-object value", () => {
    expect(isCloudflareGatewayListDetail("not an object")).toBe(false);
  });
});
