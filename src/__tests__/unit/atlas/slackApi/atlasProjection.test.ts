import { describe, expect, it } from "vitest";

import {
  matchMethodSurfaces,
  projectApiMethods,
  projectBrowserMethods,
  projectPages,
  sdkResponsePaths,
} from "../../../../atlas/slackApi/atlasProjection.js";

import { capturedCall, drivenPage, sdkMethod } from "./slackAtlasFixtures.js";

const AT = "2026-08-31T09:00:00.000Z";
const SDK_NAMES = new Set(["conversations.history"]);
const SDK_PARAMS = new Map([["conversations.history", new Set(["channel", "limit"])]]);

describe("sdkResponsePaths", () => {
  it("flattens the top level and one level down into one sorted list", () => {
    expect(sdkResponsePaths({ method: sdkMethod() })).toEqual(["messages", "messages[].text", "messages[].ts", "ok"]);
  });

  it("is empty when the SDK declares no response shape", () => {
    expect(sdkResponsePaths({ method: sdkMethod({ responseFields: [], responseNested: {} }) })).toEqual([]);
  });
});

describe("projectApiMethods", () => {
  it("fills the api channel and leaves the browser channel empty", () => {
    const entity = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;
    expect(entity.channels.browser).toBe(null);
    expect(entity.channels.api!.channel).toBe("api");
  });

  it("stores the declared argument and response names", () => {
    const entity = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;
    expect(entity.channels.api!.detail).toEqual({
      description: "Fetches a conversation's history of messages and events.",
      paramNames: ["channel", "limit"],
      responsePaths: ["messages", "messages[].text", "messages[].ts", "ok"],
    });
  });

  it("marks its deep link unverified — the SDK hands back no URL, and a guessed one is not provider-provided", () => {
    const entity = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;
    expect(entity.channels.api!.source!.deepLinkStatus).toBe("unverified");
    expect(entity.channels.api!.source!.deepLink).toBe(null);
  });

  it("keys the entity on the dotted method name", () => {
    expect(projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!.providerId).toBe("conversations.history");
  });

  it("produces nothing from no methods", () => {
    expect(projectApiMethods({ at: AT, methods: [] })).toEqual([]);
  });
});

describe("projectBrowserMethods", () => {
  it("writes browser-discovered provenance — the state only a driven browser can produce", () => {
    const entity = projectBrowserMethods({
      pages: [drivenPage()],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("records the page the browser was actually standing on as the deep link", () => {
    const entity = projectBrowserMethods({
      pages: [drivenPage()],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.source!.deepLink).toBe("https://app.slack.com/client/T0SYN1ABCDEFGH/today");
  });

  it("holds the page's screenshot as the record's own artifact", () => {
    const entity = projectBrowserMethods({
      pages: [drivenPage()],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.source!.artifacts[0]!.kind).toBe("page-png");
  });

  it("stores the FULL observed parameter set, not the diff against the SDK", () => {
    const entity = projectBrowserMethods({
      pages: [drivenPage({ calls: [capturedCall({ paramNames: ["channel", "include_tombstones", "_x_id"] })] })],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.detail).toEqual({
      callCount: 1,
      paramNames: ["channel", "include_tombstones"],
      responsePaths: ["messages", "messages[].ts", "ok"],
      responsePathsTotal: 3,
    });
  });

  it("counts repeat calls across pages rather than deduplicating them away", () => {
    const entity = projectBrowserMethods({
      pages: [
        drivenPage(),
        drivenPage({ path: "/client/<team>/activity", url: "https://app.slack.com/client/T0SYN1ABCDEFGH/activity" }),
      ],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.detail).toMatchObject({ callCount: 2 });
  });

  it("keeps the FIRST page's address when a method is seen on several", () => {
    const entity = projectBrowserMethods({
      pages: [
        drivenPage(),
        drivenPage({ path: "/client/<team>/activity", url: "https://app.slack.com/client/T0SYN1ABCDEFGH/activity" }),
      ],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.source!.deepLink).toBe("https://app.slack.com/client/T0SYN1ABCDEFGH/today");
  });

  it("leaves artifacts empty when the page could not be photographed", () => {
    const entity = projectBrowserMethods({
      pages: [drivenPage({ screenshot: null })],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    })[0]!;
    expect(entity.channels.browser!.source!.artifacts).toEqual([]);
  });

  it("produces nothing from a walk that reached no page", () => {
    expect(projectBrowserMethods({ pages: [], sdkMethodNames: SDK_NAMES, sdkParamsByMethod: SDK_PARAMS })).toEqual([]);
  });
});

describe("projectPages", () => {
  it("gives each driven page its own entity, browser-discovered", () => {
    const entity = projectPages({ pages: [drivenPage()] })[0]!;
    expect(entity.kind).toBe("page");
    expect(entity.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("leaves the api channel permanently null — a page has no API counterpart", () => {
    expect(projectPages({ pages: [drivenPage()] })[0]!.channels.api).toBe(null);
  });

  it("stores the title, the settled address and how many calls the page caused", () => {
    expect(projectPages({ pages: [drivenPage()] })[0]!.channels.browser!.detail).toEqual({
      apiCallCount: 1,
      title: "Today",
      url: "https://app.slack.com/client/T0SYN1ABCDEFGH/today",
    });
  });

  it("keys the page on its workspace-free surface path", () => {
    expect(projectPages({ pages: [drivenPage()] })[0]!.providerId).toBe("/client/<team>/today");
  });
});

describe("matchMethodSurfaces", () => {
  const api = projectApiMethods({ at: AT, methods: [sdkMethod()] });
  const browser = projectBrowserMethods({
    pages: [drivenPage()],
    sdkMethodNames: SDK_NAMES,
    sdkParamsByMethod: SDK_PARAMS,
  });

  it("folds a byte-exact name match into ONE entity carrying both channels", () => {
    const matched = matchMethodSurfaces({ api, browser });
    expect(matched).toHaveLength(1);
    expect(matched[0]!.channels.api!.channel).toBe("api");
    expect(matched[0]!.channels.browser!.channel).toBe("browser");
  });

  it("keeps a near-miss name as its own entity rather than folding it into its documented cousin", () => {
    const onlyBrowser = projectBrowserMethods({
      pages: [drivenPage({ calls: [capturedCall({ name: "conversations.history.v2" })] })],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    });
    expect(
      matchMethodSurfaces({ api, browser: onlyBrowser })
        .map((entity) => entity.providerId)
        .toSorted(),
    ).toEqual(["conversations.history", "conversations.history.v2"]);
  });

  it("leaves an api-only method's browser channel null rather than inventing one", () => {
    expect(matchMethodSurfaces({ api, browser: [] })[0]!.channels.browser).toBe(null);
  });

  it("returns nothing when neither surface saw anything", () => {
    expect(matchMethodSurfaces({ api: [], browser: [] })).toEqual([]);
  });
});
