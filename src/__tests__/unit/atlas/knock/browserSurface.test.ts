/**
 * The pure half of publishing a Knock dashboard walk: the browser-channel projection, the per-page gaps, the
 * call census and the tally the coverage cell and the verb both quote.
 */
import { describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";
import type { KnockObservedCall } from "../../../../atlas/knock/browserReduction.js";
import {
  knockCallCensus,
  knockWalkGaps,
  knockWalkTally,
  projectKnockWalk,
} from "../../../../atlas/knock/browserSurface.js";
import type { KnockPageObservation } from "../../../../atlas/knock/browserWalk.js";
import { openKnockGap } from "../../../../atlas/knock/gaps.js";
import { knockEntityId } from "../../../../atlas/knock/identity.js";

const AT = "2026-10-13T09:00:00.000Z";

const ARTIFACT: AtlasArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/pages/workflows.png",
  sha256: "b".repeat(64),
};

/** A registry-matched Management API call under `/v1/`. */
const WORKFLOWS_CALL: KnockObservedCall = {
  api: "management",
  host: "control.knock.app",
  method: "GET",
  responseFields: ["entries", "page_info"],
  statusCode: 200,
  wirePath: "/v1/workflows/{workflow_key}",
};

/** The dashboard's own origin: no published API serves it. */
const DASHBOARD_CALL: KnockObservedCall = {
  api: null,
  host: "dashboard.knock.app",
  method: "GET",
  responseFields: ["user"],
  statusCode: 200,
  wirePath: "/v1/session",
};

/** A published host, but a path outside `/v1/`. */
const INTERNAL_CALL: KnockObservedCall = {
  api: "data",
  host: "api.knock.app",
  method: "POST",
  responseFields: [],
  statusCode: 204,
  wirePath: "/internal/telemetry",
};

/** One page observation with every field the projection reads, overridable per case. */
function observation({
  surface,
  attempted,
  unreachableBecause,
  screenshotMissingBecause,
  artifacts,
  calls,
  title,
}: {
  surface: string;
  attempted: boolean;
  unreachableBecause: string | null;
  screenshotMissingBecause: string | null;
  artifacts: readonly AtlasArtifactRef[];
  calls: readonly KnockObservedCall[];
  title: string;
}): KnockPageObservation {
  return {
    artifacts,
    attempted,
    calls,
    captureComplete: true,
    finalUrl: attempted ? `https://dashboard.knock.app/acme${surface}` : "",
    observedAt: AT,
    redirected: unreachableBecause !== null,
    requestedUrl: attempted ? `https://dashboard.knock.app/acme${surface}` : "",
    responseAccounting: { bodyFailed: 0, bodySucceeded: calls.length, eligible: calls.length, seen: calls.length },
    screenshotMissingBecause,
    statusCode: attempted ? 200 : null,
    surface,
    title,
    unreachableBecause,
  };
}

/** Held, reached-without-a-picture, unreachable and never-attempted — one of each. */
function walkPages(): readonly KnockPageObservation[] {
  return [
    observation({
      artifacts: [ARTIFACT],
      attempted: true,
      calls: [WORKFLOWS_CALL, WORKFLOWS_CALL],
      screenshotMissingBecause: null,
      surface: "/[slug]/workflows",
      title: "Workflows",
      unreachableBecause: null,
    }),
    observation({
      artifacts: [],
      attempted: true,
      calls: [WORKFLOWS_CALL, DASHBOARD_CALL],
      screenshotMissingBecause: "the capture was still a loading frame",
      surface: "/[slug]/channels",
      title: "Channels",
      unreachableBecause: null,
    }),
    observation({
      artifacts: [],
      attempted: true,
      calls: [INTERNAL_CALL],
      screenshotMissingBecause: null,
      surface: "/[slug]/billing",
      title: "",
      unreachableBecause: "the dashboard rewrote the address to the environment overview",
    }),
    observation({
      artifacts: [],
      attempted: false,
      calls: [],
      screenshotMissingBecause: null,
      surface: "/[slug]/audit-log",
      title: "",
      unreachableBecause: null,
    }),
  ];
}

describe("projectKnockWalk", () => {
  it("emits one browser-channel entity per ATTEMPTED page and none for a page the walk never reached", () => {
    const entities = projectKnockWalk({ at: AT, pages: walkPages() });
    expect(entities.map((entity) => entity.providerId)).toEqual([
      "/[slug]/workflows",
      "/[slug]/channels",
      "/[slug]/billing",
    ]);
  });

  it("projects a held page whole, its requested URL as the browser-discovered deep link", () => {
    const [held] = projectKnockWalk({ at: AT, pages: walkPages() });
    expect(held).toEqual({
      channels: {
        api: null,
        browser: {
          channel: "browser",
          detail: {
            observedCalls: [
              {
                api: "management",
                host: "control.knock.app",
                method: "GET",
                responseFields: ["entries", "page_info"],
                statusCode: 200,
                wirePath: "/v1/workflows/{workflow_key}",
              },
              {
                api: "management",
                host: "control.knock.app",
                method: "GET",
                responseFields: ["entries", "page_info"],
                statusCode: 200,
                wirePath: "/v1/workflows/{workflow_key}",
              },
            ],
            redirected: false,
            title: "Workflows",
            unreachableBecause: null,
          },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: {
            artifacts: [ARTIFACT],
            channel: "browser",
            deepLink: "https://dashboard.knock.app/acme/[slug]/workflows",
            deepLinkStatus: "browser-discovered",
            endpoint: "/[slug]/workflows",
            observedAt: AT,
          },
          state: "observed",
        },
      },
      id: knockEntityId({ kind: "dashboard-route", providerId: "/[slug]/workflows" }),
      kind: "dashboard-route",
      providerId: "/[slug]/workflows",
      scope: null,
    });
  });

  it("stores an empty page title as null and carries the unreachable reason", () => {
    const billing = projectKnockWalk({ at: AT, pages: walkPages() })[2]!;
    expect(billing.channels.browser!.detail).toEqual({
      observedCalls: [
        {
          api: "data",
          host: "api.knock.app",
          method: "POST",
          responseFields: [],
          statusCode: 204,
          wirePath: "/internal/telemetry",
        },
      ],
      redirected: true,
      title: null,
      unreachableBecause: "the dashboard rewrote the address to the environment overview",
    });
  });
});

describe("knockWalkGaps", () => {
  it("raises one page-unreachable gap per attempted page not held, scoped to its route pattern", () => {
    expect(knockWalkGaps({ at: AT, pages: walkPages() })).toEqual([
      openKnockGap({
        at: AT,
        condition: "page-unreachable",
        fields: [],
        kind: "dashboard-route",
        reason: "the capture was still a loading frame",
        scope: "/[slug]/channels",
        surfaces: ["browser"],
      }),
      openKnockGap({
        at: AT,
        condition: "page-unreachable",
        fields: [],
        kind: "dashboard-route",
        reason: "the dashboard rewrote the address to the environment overview",
        scope: "/[slug]/billing",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("names the unreachable reason ahead of a missing screenshot when a page carries both", () => {
    const both = observation({
      artifacts: [],
      attempted: true,
      calls: [],
      screenshotMissingBecause: "no picture was taken",
      surface: "/[slug]/members",
      title: "",
      unreachableBecause: "the address was rewritten",
    });
    expect(knockWalkGaps({ at: AT, pages: [both] }).map((gap) => gap.reason)).toEqual(["the address was rewritten"]);
  });
});

describe("knockCallCensus", () => {
  it("dedupes calls by method, host and path across pages and counts the ones no published /v1/ API declares", () => {
    expect(knockCallCensus({ pages: walkPages() })).toEqual({ observed: 3, undocumented: 2 });
  });

  it("counts nothing for a walk with no calls", () => {
    expect(knockCallCensus({ pages: [] })).toEqual({ observed: 0, undocumented: 0 });
  });
});

describe("knockWalkTally", () => {
  it("counts declared, reached (attempted and reachable), photographed and the census", () => {
    expect(knockWalkTally({ pages: walkPages() })).toEqual({
      declared: 4,
      observed: 3,
      photographed: 1,
      reached: 2,
      undocumented: 2,
    });
  });
});
