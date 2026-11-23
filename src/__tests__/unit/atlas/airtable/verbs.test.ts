import { describe, expect, it } from "vitest";

import { AIRTABLE_SIDE_EFFECTING_OPERATIONS } from "../../../../atlas/airtable/exclusions.js";
import { AIRTABLE_AUTH_METHOD_CENSUS } from "../../../../atlas/airtable/generated/specLock.js";
import { AIRTABLE_SURFACES } from "../../../../atlas/airtable/generated/surfaces.js";
import { foldAirtableChannel, staleAirtableChannel } from "../../../../atlas/airtable/merge.js";
import type { AirtableAtlasEntity } from "../../../../atlas/airtable/model.js";
import { airtablePagingOf } from "../../../../atlas/airtable/surfaceNaming.js";

const AT = "2026-09-05T02:00:00.000Z";
const LATER = "2026-09-06T02:00:00.000Z";

/** One method entity carrying only the channel a caller names. */
function entity({ channel, at }: { channel: "api" | "browser"; at: string }): AirtableAtlasEntity {
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
    providerId: "GET /v0/meta/bases",
    scope: null,
  };
}

describe("deciding how one Airtable operation pages", () => {
  // Four shapes across one platform. A reader asking "how do I walk this" needs the answer that is true
  // for the endpoint they are holding, not a normalised one.
  it("reads the shape off the parameter names rather than the path", () => {
    expect(airtablePagingOf({ queryParams: ["startTime", "previous", "next", "pageSize"] })).toBe("previous-next");
    expect(airtablePagingOf({ queryParams: ["cursor", "limit"] })).toBe("cursor-limit");
    expect(airtablePagingOf({ queryParams: ["startIndex", "count", "filter"] })).toBe("scim-start-index");
    expect(airtablePagingOf({ queryParams: ["pageSize", "offset"] })).toBe("offset");
    expect(airtablePagingOf({ queryParams: ["include"] })).toBe("none");
  });

  // Two endpoints one path segment apart under the same product area page differently, which is why the
  // shape cannot be derived from the path.
  it("gives the audit event stream and the audit export list different shapes", () => {
    const events = AIRTABLE_SURFACES.find((row) => row.name === "audit-log-events")!;
    const requests = AIRTABLE_SURFACES.find((row) => row.name === "list-audit-log-requests")!;

    expect(events.paging).toBe("previous-next");
    expect(requests.paging).toBe("offset");
  });
});

describe("merging one channel without touching the other", () => {
  it("carries the stored channel's first-seen stamp forward", () => {
    const merged = foldAirtableChannel({
      channel: "api",
      observed: entity({ at: LATER, channel: "api" }),
      stored: entity({ at: AT, channel: "api" }),
    });

    expect(merged.channels.api!.firstSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  // One surface succeeding must never erase what the other already knew. This is the whole two-surface
  // design expressed as one assertion.
  it("leaves the other channel exactly as it was", () => {
    const stored: AirtableAtlasEntity = {
      ...entity({ at: AT, channel: "api" }),
      channels: { ...entity({ at: AT, channel: "api" }).channels, ...entity({ at: AT, channel: "browser" }).channels },
    };

    const merged = foldAirtableChannel({ channel: "api", observed: entity({ at: LATER, channel: "api" }), stored });

    expect(merged.channels.browser!.lastSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  it("stales a channel this run refreshed and did not see", () => {
    const staled = staleAirtableChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) });

    expect(staled!.channels.api!.state).toBe("stale");
  });

  it("leaves an already-stale channel alone rather than rewriting it", () => {
    const already = staleAirtableChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) })!;

    expect(staleAirtableChannel({ channel: "api", stored: already })).toBe(null);
  });

  it("leaves a channel that never looked alone", () => {
    expect(staleAirtableChannel({ channel: "browser", stored: entity({ at: AT, channel: "api" }) })).toBe(null);
  });
});

describe("what the pinned census records about credentials", () => {
  it("matches the registry's own count for each accepted credential form", () => {
    expect(AIRTABLE_SURFACES.filter((row) => row.authMethods.includes("personalAccessToken")).length).toBe(
      AIRTABLE_AUTH_METHOD_CENSUS.personalAccessToken,
    );
    expect(AIRTABLE_SURFACES.filter((row) => row.authMethods.includes("oauthAccessToken")).length).toBe(
      AIRTABLE_AUTH_METHOD_CENSUS.oauthAccessToken,
    );
  });

  // A legacy integration holding a deprecated user API key reaches two thirds of this surface. That is a
  // security fact the atlas states for free, and a drop in this number is Airtable retiring the key.
  it("records that the deprecated user API key still reaches most operations", () => {
    expect(AIRTABLE_AUTH_METHOD_CENSUS.userApiKey).toBe(64);
    expect(AIRTABLE_SURFACES.filter((row) => row.authMethods.includes("userApiKey")).length).toBe(
      AIRTABLE_AUTH_METHOD_CENSUS.userApiKey,
    );
  });
});

describe("refusing an operation that acts on a person", () => {
  it("names every side-effecting refusal in the registry with its own reason", () => {
    const refused = AIRTABLE_SURFACES.filter((row) => row.exclusionReason === "side-effecting");

    expect(refused.map((row) => row.name)).toEqual(AIRTABLE_SIDE_EFFECTING_OPERATIONS.map((row) => row.operationId));
    expect(refused.map((row) => row.dispositionBecause)).toEqual(
      AIRTABLE_SIDE_EFFECTING_OPERATIONS.map((row) => row.reason),
    );
  });
});
