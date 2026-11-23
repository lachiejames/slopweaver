import { describe, expect, it } from "vitest";

import { TWILIO_BROWSER_PAGES } from "../../../../atlas/twilio/browserPages.js";
import type { TwilioMethodBrowserDetail, TwilioPageDetail } from "../../../../atlas/twilio/model.js";
import type { ConsolePageObservation, TwilioWalkResult } from "../../../../atlas/twilio/walk.js";
import { outcomeExplanation, projectTwilioPages, walkGaps } from "../../../../atlas/twilio/walkPages.js";
import { projectTwilioObservedMethods } from "../../../../atlas/twilio/walkPublish.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One page observation, with only what a test varies overridden. */
function page(over: Partial<ConsolePageObservation> = {}): ConsolePageObservation {
  return {
    artifacts: [
      {
        byteLength: 3,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: "artifacts/console/a.png",
        sha256: "a".repeat(64),
      },
    ],
    discoveredFrom: null,
    finalUrl: "https://console.twilio.com/us1/develop/sms/services",
    linksRendered: [],
    outcome: "landed",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 9 },
    route: "/{region}/develop/sms/services",
    statusCode: 200,
    title: "Messaging Services",
    ...over,
  };
}

/** One walk result, with only what a test varies overridden. */
function walk(over: Partial<TwilioWalkResult> = {}): TwilioWalkResult {
  return {
    artifactsWritten: 1,
    calls: [],
    incompletePages: [],
    notAttempted: [],
    pages: [page()],
    region: "us1",
    roundsRun: 1,
    sessionEndedAt: null,
    signedOut: false,
    ...over,
  };
}

/** The browser-channel detail one projected page carries. */
function pageDetail({ index, result }: { index: number; result: TwilioWalkResult }): TwilioPageDetail {
  return projectTwilioPages({ at: AT, walk: result })[index]!.channels.browser!.detail as TwilioPageDetail;
}

describe("projecting one console walk into page rows", () => {
  it("carries the transport's own response accounting rather than four zeros", () => {
    expect(pageDetail({ index: 0, result: walk() }).responseAccounting).toEqual({
      bodyFailed: 0,
      bodySucceeded: 2,
      eligible: 2,
      seen: 9,
    });
  });

  it("holds the screenshot as an artifact on the page's own source", () => {
    const projected = projectTwilioPages({ at: AT, walk: walk() })[0]!;

    expect(projected.channels.browser!.source!.artifacts.length).toBe(1);
    expect(projected.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
    expect(pageDetail({ index: 0, result: walk() }).screenshotMissingBecause).toBe(null);
  });

  it("leaves the api channel untouched, so a sync can never be blanked by a walk", () => {
    expect(projectTwilioPages({ at: AT, walk: walk() })[0]!.channels.api).toBe(null);
  });

  it("says why a page is not held when it hit the sign-in wall", () => {
    const result = walk({ pages: [page({ artifacts: [], outcome: "signed-out" })] });

    expect(pageDetail({ index: 0, result }).unreachableBecause).toContain("Twilio's sign-in wall");
    expect(pageDetail({ index: 0, result }).redirected).toBe(true);
  });

  it("gives a landed page no unreachable reason at all", () => {
    expect(pageDetail({ index: 0, result: walk() }).unreachableBecause).toBe(null);
    expect(outcomeExplanation({ outcome: "landed" })).toBe(null);
  });

  it("names every other outcome in words a reader can act on", () => {
    expect(outcomeExplanation({ outcome: "unphotographed" })).toContain("no screenshot was written");
    expect(outcomeExplanation({ outcome: "not-attempted" })).toContain("browser session was lost");
    expect(outcomeExplanation({ outcome: "unavailable" })).toContain("error status");
    expect(outcomeExplanation({ outcome: "failed" })).toContain("visit failed");
  });
});

describe("projecting what the console's own client called", () => {
  it("folds one endpoint called from two pages into one row naming both", () => {
    const result = walk({
      calls: [
        { body: { items: [] }, method: "GET", onPage: "/a", statusCode: 200, url: "https://console.twilio.com/api/x" },
        { body: { items: [] }, method: "GET", onPage: "/b", statusCode: 200, url: "https://console.twilio.com/api/x" },
      ],
      pages: [page({ route: "/a" }), page({ route: "/b" })],
    });

    const projected = projectTwilioObservedMethods({ at: AT, walk: result });
    expect(projected.length).toBe(1);
    const detail = projected[0]!.channels.browser!.detail as TwilioMethodBrowserDetail;
    expect(detail.callCount).toBe(2);
    expect([...detail.seenOnPages]).toEqual(["/a", "/b"]);
  });

  it("redacts a SID out of the path shape it keys on", () => {
    const result = walk({
      calls: [
        {
          body: {},
          method: "GET",
          onPage: "/a",
          statusCode: 200,
          url: `https://console.twilio.com/api/services/MG${"a".repeat(32)}`,
        },
      ],
      pages: [page({ route: "/a" })],
    });

    expect(projectTwilioObservedMethods({ at: AT, walk: result })[0]!.providerId).toBe("GET /api/services/<sid>");
  });

  // A NAME says what the endpoint accepts; the telemetry pattern is what keeps a session token out.
  it("records the query parameter names the console sent and drops the telemetry ones", () => {
    const result = walk({
      calls: [
        {
          body: {},
          method: "GET",
          onPage: "/a",
          statusCode: 200,
          url: "https://console.twilio.com/api/x?PageSize=50&Status=undelivered&csrfToken=abc&_=1717",
        },
      ],
      pages: [page({ route: "/a" })],
    });
    const detail = projectTwilioObservedMethods({ at: AT, walk: result })[0]!.channels.browser!
      .detail as TwilioMethodBrowserDetail;

    expect([...detail.parameters]).toEqual(["PageSize", "Status"]);
  });

  it("widens the parameter names across every page that made the same call", () => {
    const result = walk({
      calls: [
        { body: {}, method: "GET", onPage: "/a", statusCode: 200, url: "https://console.twilio.com/api/x?PageSize=50" },
        { body: {}, method: "GET", onPage: "/b", statusCode: 200, url: "https://console.twilio.com/api/x?To=%2B61" },
      ],
      pages: [page({ route: "/a" }), page({ route: "/b" })],
    });
    const detail = projectTwilioObservedMethods({ at: AT, walk: result })[0]!.channels.browser!
      .detail as TwilioMethodBrowserDetail;

    expect([...detail.parameters]).toEqual(["PageSize", "To"]);
  });

  it("records the origin the call went to, so a console-only host is visible as one", () => {
    const result = walk({
      calls: [{ body: {}, method: "GET", onPage: "/a", statusCode: 200, url: "https://console.twilio.com/api/x" }],
      pages: [page({ route: "/a" })],
    });
    const detail = projectTwilioObservedMethods({ at: AT, walk: result })[0]!.channels.browser!
      .detail as TwilioMethodBrowserDetail;

    expect(detail.host).toBe("https://console.twilio.com");
  });
});

describe("the gaps one walk earns", () => {
  // Eighty rows saying "redirected" is a reader having to work out for themselves that they are one
  // sign-in.
  it("raises ONE gap when the console is signed out, naming what was not attempted", () => {
    const result = walk({
      notAttempted: TWILIO_BROWSER_PAGES.slice(1).map((declared) => declared.route),
      pages: [page({ artifacts: [], outcome: "signed-out" })],
      signedOut: true,
    });
    const gaps = walkGaps({ at: AT, walk: result });

    expect(gaps.length).toBe(1);
    expect(gaps[0]!.condition).toBe("console-signed-out");
    expect(gaps[0]!.reason).toContain(`${String(TWILIO_BROWSER_PAGES.length - 1)} further declared route(s)`);
  });

  it("raises one gap per page when the reasons genuinely differ", () => {
    const result = walk({
      pages: [
        page(),
        page({ artifacts: [], outcome: "unphotographed", route: "/b" }),
        page({ outcome: "unavailable", route: "/c" }),
      ],
    });
    const gaps = walkGaps({ at: AT, walk: result });

    expect(gaps.length).toBe(2);
    expect(gaps.map((gap) => gap.condition)).toEqual(["page-unphotographed", "page-unreachable"]);
  });

  it("states each page gap's reason as its route plus why it is not held", () => {
    const gaps = walkGaps({ at: AT, walk: walk({ pages: [page(), page({ outcome: "unavailable", route: "/c" })] }) });

    expect(gaps.map((gap) => gap.reason)).toEqual(["/c: the console answered an error status for this route"]);
  });

  it("raises no gap at all when every page landed", () => {
    expect(walkGaps({ at: AT, walk: walk() })).toEqual([]);
  });
});
