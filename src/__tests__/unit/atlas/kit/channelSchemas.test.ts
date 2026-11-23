import { describe, expect, it } from "vitest";
import { z } from "zod";

import { browserObservationView } from "../../../../atlas/kit/channelEntity.js";
import { channelSchemas } from "../../../../atlas/kit/channelSchemas.js";

const AT = "2026-10-12T00:00:00.000Z";

const SCHEMAS = channelSchemas({
  channelSlots: ({ channelEntity }) =>
    z.object({ api: channelEntity.nullable(), browser: channelEntity.nullable() }).strict(),
  channels: ["api", "browser"],
  kinds: ["method", "page"],
  manifestKinds: ({ kindStatus }) => z.object({ method: kindStatus, page: kindStatus }).strict(),
  platform: "example",
  schemaVersion: 2,
  visibilityScopes: ["public", "tenant"],
});

/** The kit's own browser view of one page, which is what a walk stores in an entity's browser slot. */
const BROWSER_VIEW = browserObservationView({
  artifacts: [],
  at: AT,
  deepLink: "https://console.example.com/home",
  detail: { title: "Home" },
  endpoint: "/home",
});

const ENTITY = {
  channels: { api: null, browser: BROWSER_VIEW },
  id: "example:page:/home",
  kind: "page",
  providerId: "/home",
};

const CELL = {
  artifacts: [],
  channel: "api",
  lastSuccessAt: AT,
  latestAttemptFailed: false,
  reason: "every page listed",
  role: "authoritative",
  scope: "tenant",
  state: "synced",
  surface: "pages",
  unblockedBy: null,
  visibilityScope: "tenant",
};

const PAGE_DETAIL = {
  callCount: 3,
  captureComplete: true,
  finalUrl: "https://console.example.com/home",
  redirected: false,
  responseAccounting: { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 5 },
  screenshotMissingBecause: null,
  statusCode: 200,
  title: "Home",
  unreachableBecause: null,
};

describe("channelSchemas", () => {
  it("builds an empty kind file stamped with this atlas's platform and version", () => {
    expect(SCHEMAS.emptyKindFile({ kind: "page", updatedAt: AT })).toEqual({
      coverage: [],
      entities: [],
      gaps: [],
      kind: "page",
      platform: "example",
      schemaVersion: 2,
      updatedAt: AT,
    });
  });

  it("builds an initial manifest naming every kind, each never synced", () => {
    const never = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };

    expect(SCHEMAS.initialManifest({ updatedAt: AT })).toEqual({
      kinds: { method: never, page: never },
      platform: "example",
      schemaVersion: 2,
      updatedAt: AT,
    });
  });

  it("refuses another atlas's kind file, by platform or by schema version", () => {
    const own = SCHEMAS.emptyKindFile({ kind: "method", updatedAt: AT });

    expect(SCHEMAS.kindFile.safeParse(own).success).toBe(true);
    expect(SCHEMAS.kindFile.safeParse({ ...own, platform: "hex" }).success).toBe(false);
    expect(SCHEMAS.kindFile.safeParse({ ...own, schemaVersion: 1 }).success).toBe(false);
    expect(SCHEMAS.kindFile.safeParse({ ...own, kind: "workflow" }).success).toBe(false);
  });

  it("holds a channel that never looked as an explicit null, and refuses an entity that omits the slot", () => {
    expect(SCHEMAS.entity.parse(ENTITY)).toEqual(ENTITY);
    expect(SCHEMAS.entity.safeParse({ ...ENTITY, channels: { browser: BROWSER_VIEW } }).success).toBe(false);
    expect(SCHEMAS.entity.safeParse({ ...ENTITY, channels: { ...ENTITY.channels, mcp: null } }).success).toBe(false);
  });

  it("refuses a channel view naming a channel this atlas does not have, or carrying an extra key", () => {
    expect(SCHEMAS.channelEntity.safeParse({ ...BROWSER_VIEW, channel: "mcp" }).success).toBe(false);
    expect(SCHEMAS.channelEntity.safeParse({ ...BROWSER_VIEW, extra: true }).success).toBe(false);
    expect(
      SCHEMAS.source.safeParse({ ...BROWSER_VIEW.source, surface: "pages" }).success,
      "the kit source's `surface` is renamed to `channel`, never carried beside it",
    ).toBe(false);
  });

  it("validates a coverage cell against this atlas's channels and visibility scopes", () => {
    expect(SCHEMAS.coverageCell.parse(CELL)).toEqual(CELL);
    expect(SCHEMAS.coverageCell.safeParse({ ...CELL, visibilityScope: "org" }).success).toBe(false);
    expect(SCHEMAS.coverageCell.safeParse({ ...CELL, channel: "mcp" }).success).toBe(false);
    expect(SCHEMAS.coverageCell.safeParse({ ...CELL, reason: "" }).success).toBe(false);
    expect(SCHEMAS.coverageCell.safeParse({ ...CELL, lastSuccessAt: "yesterday" }).success).toBe(false);
  });

  it("validates a gap's kind and surfaces, and lets a gap belong to no kind", () => {
    const gap = {
      condition: "page-unreachable",
      fields: ["title"],
      firstDetectedAt: AT,
      id: "gap-1",
      kind: null,
      lastCheckedAt: null,
      lastDetectedAt: AT,
      reason: "the console sent this route to its sign-in wall",
      scope: "/home",
      status: "open",
      surfaces: ["browser"],
    };

    expect(SCHEMAS.gap.parse(gap)).toEqual(gap);
    expect(SCHEMAS.gap.safeParse({ ...gap, kind: "workflow" }).success).toBe(false);
    expect(SCHEMAS.gap.safeParse({ ...gap, surfaces: ["mcp"] }).success).toBe(false);
    expect(SCHEMAS.gap.safeParse({ ...gap, fields: [""] }).success).toBe(false);
    expect(SCHEMAS.gap.safeParse({ ...gap, status: "resolved" }).success).toBe(false);
  });

  it("refuses a page detail that loses a response count or invents a field", () => {
    expect(SCHEMAS.pageDetail.parse(PAGE_DETAIL)).toEqual(PAGE_DETAIL);
    expect(
      SCHEMAS.pageDetail.safeParse({ ...PAGE_DETAIL, responseAccounting: { bodyFailed: 0, eligible: 3, seen: 5 } })
        .success,
    ).toBe(false);
    expect(SCHEMAS.pageDetail.safeParse({ ...PAGE_DETAIL, screenshotUrl: "https://x" }).success).toBe(false);
    expect(SCHEMAS.pageDetail.safeParse({ ...PAGE_DETAIL, unreachableBecause: "" }).success).toBe(false);
  });

  it("reads a kind status written before its two late fields existed, and refuses an empty digest", () => {
    const status = { digest: "a".repeat(64), entityCount: 2, lastAttempt: null, lastSuccessAt: AT };

    expect(SCHEMAS.kindStatus.parse(status)).toEqual(status);
    expect(SCHEMAS.kindStatus.parse({ ...status, permissionBlocked: null, productAbsent: null })).toEqual({
      ...status,
      permissionBlocked: null,
      productAbsent: null,
    });
    expect(SCHEMAS.kindStatus.safeParse({ ...status, digest: "" }).success).toBe(false);
    expect(SCHEMAS.kindStatus.safeParse({ ...status, entityCount: -1 }).success).toBe(false);
  });

  it("refuses a manifest missing one of this atlas's kinds", () => {
    const manifest = SCHEMAS.initialManifest({ updatedAt: AT });

    expect(SCHEMAS.manifest.safeParse({ ...manifest, kinds: { method: manifest.kinds.method } }).success).toBe(false);
  });
});
