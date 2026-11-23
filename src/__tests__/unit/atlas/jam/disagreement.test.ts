/**
 * The report collects instances and resolves nothing.
 *
 * The case that matters most is the one that reports NOTHING: with one surface unfilled there is nothing to
 * compare, and saying "no disagreements" there would be the atlas asserting a clean bill of health it has
 * not earned.
 */
import { describe, expect, it } from "vitest";

import { jamDisagreementReport } from "../../../../atlas/jam/disagreement.js";
import type { JamAtlasEntity, JamAtlasGap } from "../../../../atlas/jam/model.js";
import { emptyJamChannels } from "../../../../atlas/jam/model.js";

const AT = "2026-09-07T00:00:00.000Z";

/** One entity carrying whichever channels the case needs. */
function entity({
  kind,
  providerId,
  compiled,
  browser,
}: {
  kind: JamAtlasEntity["kind"];
  providerId: string;
  compiled?: unknown;
  browser?: unknown;
}): JamAtlasEntity {
  const slot = ({
    detail,
    channel,
  }: {
    detail: unknown;
    channel: "browser" | "compiled";
  }): JamAtlasEntity["channels"]["browser"] => ({
    channel,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [],
      channel,
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: providerId,
      observedAt: AT,
    },
    state: "observed",
  });
  return {
    channels: {
      ...emptyJamChannels(),
      ...(browser === undefined ? {} : { browser: slot({ channel: "browser", detail: browser }) }),
      ...(compiled === undefined ? {} : { compiled: slot({ channel: "compiled", detail: compiled }) }),
    },
    id: providerId,
    kind,
    providerId,
  };
}

/** One open gap on the page kind. */
function gap({ condition, scope }: { condition: JamAtlasGap["condition"]; scope: string }): JamAtlasGap {
  return {
    condition,
    fields: [],
    firstDetectedAt: AT,
    id: `${condition}:${scope}`,
    kind: "page",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: "because",
    scope,
    status: "open",
    surfaces: ["browser"],
  };
}

describe("with only one surface filled", () => {
  it("says there is nothing to compare rather than reporting agreement", () => {
    const report = jamDisagreementReport({
      integrations: [],
      operations: [entity({ compiled: { method: "GET" }, kind: "operation", providerId: "GET /whoami" })],
      pageGaps: [],
      pages: [],
    });
    expect(report.bothSurfacesFilled).toBe(false);
    expect(report.documentedCount).toBe(1);
    expect(report.walkedPageCount).toBe(0);
  });
});

describe("with both surfaces filled", () => {
  it("separates a call the description declares from one only the client makes", () => {
    const report = jamDisagreementReport({
      integrations: [],
      operations: [
        entity({ browser: {}, compiled: {}, kind: "operation", providerId: "GET /whoami" }),
        entity({
          browser: { method: "POST", onPages: ["/s/settings"], origin: "https://api.jam.dev", pathShape: "/v1/x" },
          kind: "operation",
          providerId: "POST /v1/x",
        }),
        entity({
          browser: { method: "POST", onPages: ["/"], origin: "https://mcp.jam.dev", pathShape: "/mcp" },
          kind: "operation",
          providerId: "POST https://mcp.jam.dev/mcp",
        }),
      ],
      pageGaps: [],
      pages: [entity({ browser: {}, kind: "page", providerId: "/s/settings" })],
    });
    expect(report.bothSurfacesFilled).toBe(true);
    expect(report.corroboratedCount).toBe(1);
    expect(report.undeclaredApiCalls.map((call) => call.pathShape)).toEqual(["/v1/x"]);
    expect(report.undocumentedOriginCalls.map((call) => call.origin)).toEqual(["https://mcp.jam.dev"]);
  });

  it("splits integrations by which channel named each", () => {
    const report = jamDisagreementReport({
      integrations: [
        entity({ compiled: { slug: "linear" }, kind: "integration", providerId: "linear" }),
        entity({
          browser: { seenOnPage: "/s/settings/integrations/notion", slug: "notion" },
          compiled: { slug: "notion" },
          kind: "integration",
          providerId: "notion",
        }),
        entity({
          browser: { seenOnPage: "/s/settings/integrations/zzz", slug: "zzz" },
          kind: "integration",
          providerId: "zzz",
        }),
      ],
      operations: [entity({ compiled: {}, kind: "operation", providerId: "GET /whoami" })],
      pageGaps: [],
      pages: [entity({ browser: {}, kind: "page", providerId: "/s/settings" })],
    });
    expect(report.integrationsPublishedOnly).toEqual(["linear"]);
    expect(report.integrationsWalkedOnly).toEqual(["zzz"]);
  });

  it("reads the walk's two page failures off the gaps rather than re-deriving them", () => {
    const report = jamDisagreementReport({
      integrations: [],
      operations: [entity({ compiled: {}, kind: "operation", providerId: "GET /whoami" })],
      pageGaps: [
        gap({ condition: "web-page-unreachable", scope: "/s/settings/webhooks" }),
        gap({ condition: "web-screenshot-missing", scope: "/s/settings/integrations" }),
        gap({ condition: "web-denominator-is-harvested", scope: "web-app" }),
      ],
      pages: [entity({ browser: {}, kind: "page", providerId: "/s/settings" })],
    });
    expect(report.unreachablePages).toEqual(["/s/settings/webhooks"]);
    expect(report.unphotographedPages).toEqual(["/s/settings/integrations"]);
  });
});
