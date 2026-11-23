import { describe, expect, it } from "vitest";

import type { NotionPageObservation } from "../../../../atlas/notion/browserWalk.js";
import type {
  NotionMethodApiDetail,
  NotionMethodBrowserDetail,
  NotionPageDetail,
} from "../../../../atlas/notion/model.js";
import {
  methodProviderId,
  projectNotionApiMethods,
  projectNotionBrowserMethods,
  projectNotionPages,
} from "../../../../atlas/notion/projection.js";
import type { NotionSdkSurface } from "../../../../atlas/notion/sdkRead.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One SDK surface holding exactly the endpoints a test names. */
function surface({ endpoints }: { endpoints: NotionSdkSurface["endpoints"] }): NotionSdkSurface {
  return { endpoints, modules: ["users"], version: "5.23.2" };
}

/** One declared endpoint, with every field set. */
function endpoint(over: Partial<NotionSdkSurface["endpoints"][number]> = {}): NotionSdkSurface["endpoints"][number] {
  return {
    bodyParams: [],
    description: "List all users",
    httpMethod: "GET",
    module: "users",
    name: "listUsers",
    pathParams: [],
    pathTemplate: "users",
    queryParams: ["start_cursor", "page_size"],
    ...over,
  };
}

/** One page observation, with every field set. */
function observation(over: Partial<NotionPageObservation> = {}): NotionPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://app.notion.com/space/my-account",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://app.notion.com/space/my-account",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 9 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "account-profile",
    title: "Notion",
    unreachableBecause: null,
    ...over,
  };
}

/** One observed call, with every field set. */
function call(over: Partial<NotionPageObservation["calls"][number]> = {}): NotionPageObservation["calls"][number] {
  return {
    method: "POST",
    operation: "getSpaces",
    pathShape: "/api/v3/getSpaces",
    responseFields: ["spaces"],
    statusCode: 200,
    ...over,
  };
}

describe("methodProviderId", () => {
  it("joins the upper-cased method to the path shape, which is what the two channels match on", () => {
    expect(methodProviderId({ httpMethod: "post", pathShape: "/api/v3/getSpaces" })).toBe("POST /api/v3/getSpaces");
  });
});

describe("projectNotionApiMethods", () => {
  it("addresses an endpoint under the API's own version root", () => {
    const rows = projectNotionApiMethods({ at: AT, surface: surface({ endpoints: [endpoint()] }) });
    expect(rows[0]!.providerId).toBe("GET /v1/users");
  });

  it("writes a path parameter as a named placeholder, so two ids do not become two rows", () => {
    const rows = projectNotionApiMethods({
      at: AT,
      surface: surface({ endpoints: [endpoint({ pathParams: ["user_id"], pathTemplate: "users/{user_id}" })] }),
    });
    expect(rows[0]!.providerId).toBe("GET /v1/users/{user_id}");
  });

  it("falls back to the SDK's own module and name when an endpoint declares no path", () => {
    const rows = projectNotionApiMethods({
      at: AT,
      surface: surface({ endpoints: [endpoint({ pathTemplate: null })] }),
    });
    expect(rows[0]!.providerId).toBe("GET /v1/users.listUsers");
  });

  // The real shape, measured on @notionhq/client 5.26.0: `agents.updateSession` and
  // `agents.updateSessionStream` declare an identical `post` + `sessions` + body-param set, differing only
  // by `headers: { Accept: "text/event-stream" }`. Projected one-per-declaration that minted the SAME
  // entity id twice and `merge.ts` refused the whole publish. These three pin the fold.
  it("folds several SDK handles for ONE route into a single entity", () => {
    const rows = projectNotionApiMethods({
      at: AT,
      surface: surface({
        endpoints: [
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSessionStream", pathTemplate: "sessions" }),
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSession", pathTemplate: "sessions" }),
        ],
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerId).toBe("POST /v1/sessions");
  });

  it("keeps the folded-away handles on the row rather than discarding them", () => {
    const rows = projectNotionApiMethods({
      at: AT,
      surface: surface({
        endpoints: [
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSessionStream", pathTemplate: "sessions" }),
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSession", pathTemplate: "sessions" }),
        ],
      }),
    });
    const detail = rows[0]!.channels.api!.detail as NotionMethodApiDetail;
    expect(detail.name).toBe("updateSession");
    expect(detail.alsoDeclaredAs).toEqual(["agents.updateSessionStream"]);
  });

  it("picks the canonical handle by NAME, so a vendor reordering its file does not move the bytes", () => {
    const reversed = projectNotionApiMethods({
      at: AT,
      surface: surface({
        endpoints: [
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSession", pathTemplate: "sessions" }),
          endpoint({ httpMethod: "POST", module: "agents", name: "updateSessionStream", pathTemplate: "sessions" }),
        ],
      }),
    });
    const detail = reversed[0]!.channels.api!.detail as NotionMethodApiDetail;
    expect(detail.name).toBe("updateSession");
    expect(detail.alsoDeclaredAs).toEqual(["agents.updateSessionStream"]);
  });

  it("leaves an ordinary one-handle endpoint with no extra handles at all", () => {
    const rows = projectNotionApiMethods({ at: AT, surface: surface({ endpoints: [endpoint()] }) });
    expect((rows[0]!.channels.api!.detail as NotionMethodApiDetail).alsoDeclaredAs).toEqual([]);
  });

  it("leaves the browser channel empty, so a sync can never blank what a walk saw", () => {
    const rows = projectNotionApiMethods({ at: AT, surface: surface({ endpoints: [endpoint()] }) });
    expect(rows[0]!.channels.browser).toBeNull();
  });

  it("stores the SDK's own handles, so a reader can go straight to the declaration", () => {
    const rows = projectNotionApiMethods({ at: AT, surface: surface({ endpoints: [endpoint()] }) });
    const detail = rows[0]!.channels.api!.detail as NotionMethodApiDetail;
    expect(detail.name).toBe("listUsers");
  });

  it("sorts the parameter names, so two runs write identical bytes", () => {
    const rows = projectNotionApiMethods({
      at: AT,
      surface: surface({ endpoints: [endpoint({ queryParams: ["page_size", "start_cursor"] })] }),
    });
    expect((rows[0]!.channels.api!.detail as NotionMethodApiDetail).queryParams).toEqual(["page_size", "start_cursor"]);
  });

  it("says the REST API has no page to open, rather than leaving an absent link unexplained", () => {
    const rows = projectNotionApiMethods({ at: AT, surface: surface({ endpoints: [endpoint()] }) });
    expect(rows[0]!.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });
});

describe("projectNotionBrowserMethods", () => {
  it("makes one row per distinct operation", () => {
    const rows = projectNotionBrowserMethods({ at: AT, pages: [observation({ calls: [call(), call()] })] });
    expect(rows.length).toBe(1);
  });

  it("counts how many times the operation was seen", () => {
    const rows = projectNotionBrowserMethods({ at: AT, pages: [observation({ calls: [call(), call()] })] });
    expect((rows[0]!.channels.browser!.detail as NotionMethodBrowserDetail).callCount).toBe(2);
  });

  it("widens the observed field set across pages, rather than letting the last page win", () => {
    const rows = projectNotionBrowserMethods({
      at: AT,
      pages: [
        observation({ calls: [call({ responseFields: ["spaces"] })] }),
        observation({ calls: [call({ responseFields: ["users"] })], surface: "space-members" }),
      ],
    });
    expect((rows[0]!.channels.browser!.detail as NotionMethodBrowserDetail).responseFields).toEqual([
      "spaces",
      "users",
    ]);
  });

  it("records which declared pages caused the call, which is where the lead can be reproduced", () => {
    const rows = projectNotionBrowserMethods({
      at: AT,
      pages: [observation({ calls: [call()] }), observation({ calls: [call()], surface: "space-members" })],
    });
    expect((rows[0]!.channels.browser!.detail as NotionMethodBrowserDetail).seenOnPages).toEqual([
      "account-profile",
      "space-members",
    ]);
  });

  it("leaves the api channel empty, so a walk can never blank the declared endpoints", () => {
    const rows = projectNotionBrowserMethods({ at: AT, pages: [observation({ calls: [call()] })] });
    expect(rows[0]!.channels.api).toBeNull();
  });

  it("makes no row at all for a page that observed nothing", () => {
    expect(projectNotionBrowserMethods({ at: AT, pages: [observation()] })).toEqual([]);
  });
});

describe("projectNotionPages", () => {
  it("keys a page entity on its declared surface, never on a URL", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation()] });
    expect(rows[0]!.providerId).toBe("account-profile");
  });

  it("carries the reachability verdict onto the entity", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation({ unreachableBecause: "sent elsewhere" })] });
    expect((rows[0]!.channels.browser!.detail as NotionPageDetail).unreachableBecause).toBe("sent elsewhere");
  });

  it("carries the response accounting, so an incomplete capture is a number rather than a silence", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation()] });
    expect((rows[0]!.channels.browser!.detail as NotionPageDetail).responseAccounting.bodySucceeded).toBe(3);
  });

  it("records the requested address as the deep link a human opens for the proof", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation()] });
    expect(rows[0]!.channels.browser!.source!.deepLink).toBe("https://app.notion.com/space/my-account");
  });

  it("marks that deep link as browser-discovered, which only a driven browser can write", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation()] });
    expect(rows[0]!.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("gives a page that was never addressed no deep link at all", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation({ attempted: false, requestedUrl: "" })] });
    expect(rows[0]!.channels.browser!.source!.deepLink).toBeNull();
  });

  it("still gives a page that was never addressed a reproduction handle", () => {
    const rows = projectNotionPages({ at: AT, pages: [observation({ attempted: false, requestedUrl: "" })] });
    expect(rows[0]!.channels.browser!.source!.endpoint).toBe("account-profile");
  });
});
