import { describe, expect, it } from "vitest";

import {
  emptySlackAtlasKindFile,
  initialSlackAtlasManifest,
  SLACK_ATLAS_CHANNELS,
  SLACK_ATLAS_KINDS,
  SLACK_ATLAS_PLATFORM,
  slackAtlasGapSchema,
  slackAtlasKindFileSchema,
  slackAtlasManifestSchema,
  slackChannelEntitySchema,
  slackMethodBrowserDetailSchema,
  slackPageDetailSchema,
  slackSourceSchema,
} from "../../../../atlas/slackApi/atlasModel.js";

const AT = "2026-08-31T09:00:00.000Z";

describe("the Slack atlas vocabulary", () => {
  it("is ONE platform, so the API and the browser are surfaces rather than atlases", () => {
    expect(SLACK_ATLAS_PLATFORM).toBe("slack");
  });

  it("holds two kinds: the methods that can be asked, and the pages that were driven", () => {
    expect([...SLACK_ATLAS_KINDS]).toEqual(["method", "page"]);
  });

  it("names two channels", () => {
    expect([...SLACK_ATLAS_CHANNELS]).toEqual(["api", "browser"]);
  });
});

describe("slackSourceSchema", () => {
  it("accepts a browser-discovered link, the state only a driven browser writes", () => {
    const parsed = slackSourceSchema.safeParse({
      artifacts: [],
      channel: "browser",
      deepLink: "https://app.slack.com/client/T0SYN1ABCDEFGH",
      deepLinkStatus: "browser-discovered",
      endpoint: "/api/client.counts",
      observedAt: AT,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a null status even when the link itself is absent — absence must say why", () => {
    const parsed = slackSourceSchema.safeParse({
      artifacts: [],
      channel: "api",
      deepLink: null,
      deepLinkStatus: null,
      endpoint: "/api/conversations.history",
      observedAt: AT,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a surface name this atlas does not declare", () => {
    const parsed = slackSourceSchema.safeParse({
      artifacts: [],
      channel: "har-capture",
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "/api/conversations.history",
      observedAt: AT,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("slackChannelEntitySchema", () => {
  it("accepts an observed channel view", () => {
    const parsed = slackChannelEntitySchema.safeParse({
      channel: "browser",
      detail: { callCount: 1, paramNames: [], responsePaths: [], responsePathsTotal: 0 },
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: null,
      state: "observed",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a state outside observed/stale", () => {
    const parsed = slackChannelEntitySchema.safeParse({
      channel: "browser",
      detail: null,
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: null,
      state: "pending",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("slackMethodBrowserDetailSchema", () => {
  it("refuses a zero call count — a browser channel exists because a call was SEEN", () => {
    const parsed = slackMethodBrowserDetailSchema.safeParse({
      callCount: 0,
      paramNames: [],
      responsePaths: [],
      responsePathsTotal: 0,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("slackPageDetailSchema", () => {
  it("refuses a page whose address is not a URL", () => {
    expect(slackPageDetailSchema.safeParse({ apiCallCount: 0, title: "x", url: "/client" }).success).toBe(false);
  });
});

describe("slackAtlasGapSchema", () => {
  it("stores the fields a disagreement is ABOUT, not merely that one happened", () => {
    const parsed = slackAtlasGapSchema.safeParse({
      condition: "api-browser-disagreement",
      fields: ["param:include_tombstones"],
      firstDetectedAt: AT,
      id: "abc",
      kind: "method",
      lastCheckedAt: AT,
      lastDetectedAt: AT,
      reason: "the web client sent a parameter the SDK does not declare",
      scope: "conversations.history",
      status: "open",
      surfaces: ["api", "browser"],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a surface name outside this atlas's two channels", () => {
    const parsed = slackAtlasGapSchema.safeParse({
      condition: "api-browser-disagreement",
      fields: [],
      firstDetectedAt: AT,
      id: "abc",
      kind: "method",
      lastCheckedAt: AT,
      lastDetectedAt: AT,
      reason: "x",
      scope: "conversations.history",
      status: "open",
      surfaces: ["har"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("emptySlackAtlasKindFile", () => {
  it("is a valid kind file with nothing in it", () => {
    expect(slackAtlasKindFileSchema.safeParse(emptySlackAtlasKindFile({ kind: "page", updatedAt: AT })).success).toBe(
      true,
    );
  });

  it("stamps its own kind and platform", () => {
    expect(emptySlackAtlasKindFile({ kind: "page", updatedAt: AT })).toMatchObject({ kind: "page", platform: "slack" });
  });
});

describe("initialSlackAtlasManifest", () => {
  it("is a valid manifest with every kind present and never synced", () => {
    const manifest = initialSlackAtlasManifest({ sdkVersion: "7.9.3", updatedAt: AT });
    expect(slackAtlasManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.kinds.method.lastSuccessAt).toBe(null);
  });

  it("records the SDK version the API channel was read from, so a stale generation announces itself", () => {
    expect(initialSlackAtlasManifest({ sdkVersion: "7.9.3", updatedAt: AT }).sdkVersion).toBe("7.9.3");
  });

  it("refuses a manifest with no SDK version at all", () => {
    const manifest = { ...initialSlackAtlasManifest({ sdkVersion: "7.9.3", updatedAt: AT }), sdkVersion: "" };
    expect(slackAtlasManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
