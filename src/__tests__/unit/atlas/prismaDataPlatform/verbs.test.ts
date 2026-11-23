import { describe, expect, it } from "vitest";

import { PRISMA_DATA_PLATFORM_SURFACES } from "../../../../atlas/prismaDataPlatform/generated/surfaces.js";
import { foldPrismaChannel, stalePrismaChannel } from "../../../../atlas/prismaDataPlatform/merge.js";
import type { PrismaDataPlatformEntity } from "../../../../atlas/prismaDataPlatform/model.js";
import { prismaPagingOf } from "../../../../atlas/prismaDataPlatform/surfaceNaming.js";

const AT = "2026-09-06T02:00:00.000Z";
const LATER = "2026-09-07T02:00:00.000Z";

/** One method entity carrying only the channel a caller names. */
function entity({ channel, at }: { channel: "api" | "browser"; at: string }): PrismaDataPlatformEntity {
  const observed = {
    channel,
    detail: { seen: at },
    firstSeenAt: at,
    lastSeenAt: at,
    source: null,
    state: "observed" as const,
  };
  return {
    channels: { api: channel === "api" ? observed : null, browser: channel === "browser" ? observed : null },
    id: "abc",
    kind: "method",
    providerId: "GET /v1/me",
    scope: null,
  };
}

describe("deciding how one Prisma operation pages", () => {
  it("reads the shape off the response media type before the parameter names", () => {
    expect(prismaPagingOf({ mediaTypes: ["application/x-ndjson"], queryParams: ["cursor", "follow"] })).toBe(
      "log-cursor",
    );
    expect(prismaPagingOf({ mediaTypes: ["application/json"], queryParams: ["cursor", "limit"] })).toBe("cursor");
    expect(prismaPagingOf({ mediaTypes: ["application/json"], queryParams: ["limit"] })).toBe("none");
    expect(prismaPagingOf({ mediaTypes: [], queryParams: [] })).toBe("none");
  });

  // The media type is what separates a stream from a page: both take a `cursor`, and only one of them
  // ends. A rule reading parameter names alone would call the build log a collection walk.
  it("gives the build log and the build listing different shapes", () => {
    expect(PRISMA_DATA_PLATFORM_SURFACES.find((row) => row.path === "/v1/builds/{buildId}/logs")!.paging).toBe(
      "log-cursor",
    );
    expect(PRISMA_DATA_PLATFORM_SURFACES.find((row) => row.path === "/v1/builds" && row.method === "GET")!.paging).toBe(
      "cursor",
    );
  });

  it("calls the retention-bounded backup listing unpaged, because it takes no cursor at all", () => {
    expect(PRISMA_DATA_PLATFORM_SURFACES.find((row) => row.path === "/v1/databases/{databaseId}/backups")!.paging).toBe(
      "none",
    );
  });
});

describe("merging one channel without touching the other", () => {
  it("carries the stored channel's first-seen stamp forward", () => {
    const merged = foldPrismaChannel({
      channel: "api",
      observed: entity({ at: LATER, channel: "api" }),
      stored: entity({ at: AT, channel: "api" }),
    });

    expect(merged.channels.api!.firstSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  // Here the browser channel arrives late and all at once, against an API channel that has been maintained
  // for months. A merge that staled by kind would blank the whole API surface the first time a walk ran.
  it("leaves the other channel exactly as it was", () => {
    const base = entity({ at: AT, channel: "api" });
    const stored: PrismaDataPlatformEntity = {
      ...base,
      channels: { ...base.channels, ...entity({ at: AT, channel: "browser" }).channels },
    };

    const merged = foldPrismaChannel({ channel: "api", observed: entity({ at: LATER, channel: "api" }), stored });

    expect(merged.channels.browser!.lastSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  it("stales a channel this run refreshed and did not see", () => {
    const staled = stalePrismaChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) });

    expect(staled!.channels.api!.state).toBe("stale");
  });

  it("leaves an already-stale channel alone rather than rewriting it", () => {
    const already = stalePrismaChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) })!;

    expect(stalePrismaChannel({ channel: "api", stored: already })).toBe(null);
  });

  it("leaves a channel that never looked alone", () => {
    expect(stalePrismaChannel({ channel: "browser", stored: entity({ at: AT, channel: "api" }) })).toBe(null);
  });
});
