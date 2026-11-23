import { describe, expect, it } from "vitest";

import { FIGMA_AUTH_METHOD_CENSUS } from "../../../../atlas/figma/generated/specLock.js";
import { FIGMA_SURFACES } from "../../../../atlas/figma/generated/surfaces.js";
import { foldFigmaChannel, staleFigmaChannel } from "../../../../atlas/figma/merge.js";
import type { FigmaAtlasEntity } from "../../../../atlas/figma/model.js";
import { figmaPagingOf } from "../../../../atlas/figma/surfaceNaming.js";

const AT = "2026-09-06T02:00:00.000Z";
const LATER = "2026-09-07T02:00:00.000Z";

/** One method entity carrying only the channel a caller names. */
function entity({ channel, at }: { channel: "api" | "browser"; at: string }): FigmaAtlasEntity {
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

describe("deciding how one Figma operation pages", () => {
  it("reads the shape off the parameter names rather than the path", () => {
    expect(figmaPagingOf({ queryParams: ["cursor", "group_by"] })).toBe("cursor");
    expect(figmaPagingOf({ queryParams: ["page_size", "before", "after"] })).toBe("page-size-cursor");
    expect(figmaPagingOf({ queryParams: ["events", "start_time", "end_time", "limit", "order"] })).toBe(
      "time-window-limit",
    );
    expect(figmaPagingOf({ queryParams: ["as_md"] })).toBe("none");
  });

  // The check order is load-bearing: the AI-usage feed declares BOTH a cursor and a limit, and it is a
  // cursor walk with a page limit, not a window walk.
  it("prefers the cursor when an operation declares a cursor and a limit", () => {
    expect(figmaPagingOf({ queryParams: ["start_date", "end_date", "user_email", "limit", "cursor"] })).toBe("cursor");
    expect(FIGMA_SURFACES.find((row) => row.name === "getAiUsageDaily")!.paging).toBe("cursor");
  });

  // Two operations under one tag page differently, which is why the shape cannot be derived from the path.
  it("gives the webhook listing and its request history different shapes", () => {
    expect(FIGMA_SURFACES.find((row) => row.name === "getWebhooks")!.paging).toBe("cursor");
    expect(FIGMA_SURFACES.find((row) => row.name === "getWebhookRequests")!.paging).toBe("none");
  });
});

describe("merging one channel without touching the other", () => {
  it("carries the stored channel's first-seen stamp forward", () => {
    const merged = foldFigmaChannel({
      channel: "api",
      observed: entity({ at: LATER, channel: "api" }),
      stored: entity({ at: AT, channel: "api" }),
    });

    expect(merged.channels.api!.firstSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  // On Figma several kinds are reachable through ONE channel only, so a merge that blanked the other would
  // not merely lose corroboration — it would delete the only record that exists.
  it("leaves the other channel exactly as it was", () => {
    const stored: FigmaAtlasEntity = {
      ...entity({ at: AT, channel: "api" }),
      channels: { ...entity({ at: AT, channel: "api" }).channels, ...entity({ at: AT, channel: "browser" }).channels },
    };

    const merged = foldFigmaChannel({ channel: "api", observed: entity({ at: LATER, channel: "api" }), stored });

    expect(merged.channels.browser!.lastSeenAt).toBe(AT);
    expect(merged.channels.api!.lastSeenAt).toBe(LATER);
  });

  it("stales a channel this run refreshed and did not see", () => {
    const staled = staleFigmaChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) });

    expect(staled!.channels.api!.state).toBe("stale");
  });

  it("leaves an already-stale channel alone rather than rewriting it", () => {
    const already = staleFigmaChannel({ channel: "api", stored: entity({ at: AT, channel: "api" }) })!;

    expect(staleFigmaChannel({ channel: "api", stored: already })).toBe(null);
  });

  it("leaves a channel that never looked alone", () => {
    expect(staleFigmaChannel({ channel: "browser", stored: entity({ at: AT, channel: "api" }) })).toBe(null);
  });
});

describe("what the pinned census records about credentials", () => {
  it("matches the registry's own count for each accepted credential form", () => {
    expect(FIGMA_SURFACES.filter((row) => row.authMethods.includes("PersonalAccessToken")).length).toBe(
      FIGMA_AUTH_METHOD_CENSUS.PersonalAccessToken,
    );
    expect(FIGMA_SURFACES.filter((row) => row.authMethods.includes("OAuth2")).length).toBe(
      FIGMA_AUTH_METHOD_CENSUS.OAuth2,
    );
    expect(FIGMA_SURFACES.filter((row) => row.authMethods.includes("PlanAccessToken")).length).toBe(
      FIGMA_AUTH_METHOD_CENSUS.PlanAccessToken,
    );
  });

  // Exactly one operation on Figma's whole surface accepts an organisation-scoped OAuth grant. An
  // org-level integration can read the activity log and nothing else at all — a posture fact the atlas
  // answers for free, and one a reader would otherwise derive by hand from 54 security blocks.
  it("records that an organisation-scoped grant reaches exactly one operation", () => {
    const orgScoped = FIGMA_SURFACES.filter((row) => row.authMethods.includes("OrgOAuth2"));

    expect(FIGMA_AUTH_METHOD_CENSUS.OrgOAuth2).toBe(1);
    expect(orgScoped.map((row) => row.name)).toEqual(["getActivityLogs"]);
  });
});
