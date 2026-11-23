import { describe, expect, it } from "vitest";

import type { SlackAtlasEntity } from "../../../../atlas/slackApi/atlasModel.js";
import {
  matchMethodSurfaces,
  projectApiMethods,
  projectBrowserMethods,
} from "../../../../atlas/slackApi/atlasProjection.js";
import {
  compareSurfaces,
  disagreementGaps,
  disagreements,
  summariseDisagreements,
} from "../../../../atlas/slackApi/disagreement.js";

import { capturedCall, drivenPage, sdkMethod } from "./slackAtlasFixtures.js";

const AT = "2026-08-31T09:00:00.000Z";
const SDK_NAMES = new Set(["conversations.history"]);
const SDK_PARAMS = new Map([["conversations.history", new Set(["channel", "limit"])]]);

/** Both surfaces over one set of calls, matched — exactly what the sync hands the comparison. */
function matched({ calls }: { calls: readonly ReturnType<typeof capturedCall>[] }): readonly SlackAtlasEntity[] {
  return matchMethodSurfaces({
    api: projectApiMethods({ at: AT, methods: [sdkMethod()] }),
    browser: projectBrowserMethods({
      pages: [drivenPage({ calls })],
      sdkMethodNames: SDK_NAMES,
      sdkParamsByMethod: SDK_PARAMS,
    }),
  });
}

describe("compareSurfaces", () => {
  it("reports a method both surfaces know as `both`", () => {
    expect(compareSurfaces({ entities: matched({ calls: [capturedCall()] }) })[0]!.verdict).toBe("both");
  });

  it("names the parameters the web client sent that the SDK does not declare", () => {
    const rows = compareSurfaces({
      entities: matched({
        calls: [capturedCall({ paramNames: ["channel", "include_tombstones", "no_user_profile"] })],
      }),
    });
    expect(rows[0]!.paramsBrowserOnly).toEqual(["include_tombstones", "no_user_profile"]);
  });

  it("names the response fields the web client received that the SDK does not declare", () => {
    const rows = compareSurfaces({
      entities: matched({ calls: [capturedCall({ body: { messages: [{ blocks: [] }], ok: true } })] }),
    });
    expect(rows[0]!.pathsBrowserOnly).toEqual(["messages[].blocks"]);
  });

  it("names the response fields the SDK declares that this session never saw returned", () => {
    const rows = compareSurfaces({ entities: matched({ calls: [capturedCall({ body: { ok: true } })] }) });
    expect(rows[0]!.pathsApiOnly).toEqual(["messages", "messages[].text", "messages[].ts"]);
  });

  it("reports a method only the browser called as browser-only, with no diff to report", () => {
    const rows = compareSurfaces({ entities: matched({ calls: [capturedCall({ name: "client.counts" })] }) });
    const clientCounts = rows.find((row) => row.method === "client.counts")!;
    expect(clientCounts.verdict).toBe("browser-only");
    expect(clientCounts.paramsBrowserOnly).toEqual([]);
  });

  it("reports a method only the SDK declares as api-only", () => {
    const rows = compareSurfaces({
      entities: matchMethodSurfaces({ api: projectApiMethods({ at: AT, methods: [sdkMethod()] }), browser: [] }),
    });
    expect(rows[0]!.verdict).toBe("api-only");
  });

  it("sorts the browser-only findings above the merely-comparable ones", () => {
    const rows = compareSurfaces({
      entities: matched({ calls: [capturedCall(), capturedCall({ name: "client.counts" })] }),
    });
    expect(rows.map((row) => row.method)).toEqual(["client.counts", "conversations.history"]);
  });

  it("ignores a page entity, which has no method surfaces to compare", () => {
    expect(compareSurfaces({ entities: [] })).toEqual([]);
  });
});

describe("disagreements", () => {
  it("keeps a browser-only method — the undocumented surface is the finding", () => {
    const rows = disagreements({
      comparisons: compareSurfaces({ entities: matched({ calls: [capturedCall({ name: "client.counts" })] }) }),
    });
    expect(rows.map((row) => row.method)).toEqual(["client.counts"]);
  });

  it("drops an api-only method — this session's client had no reason to call it", () => {
    const rows = disagreements({
      comparisons: compareSurfaces({
        entities: matchMethodSurfaces({ api: projectApiMethods({ at: AT, methods: [sdkMethod()] }), browser: [] }),
      }),
    });
    expect(rows).toEqual([]);
  });

  it("keeps a method whose observed parameters exceed the declared ones", () => {
    const rows = disagreements({
      comparisons: compareSurfaces({
        entities: matched({ calls: [capturedCall({ paramNames: ["channel", "include_tombstones"] })] }),
      }),
    });
    expect(rows.map((row) => row.method)).toEqual(["conversations.history"]);
  });
});

describe("disagreementGaps", () => {
  it("raises an api-browser-disagreement naming every field only one surface has", () => {
    const gaps = disagreementGaps({
      at: AT,
      comparisons: compareSurfaces({
        entities: matched({ calls: [capturedCall({ paramNames: ["channel", "include_tombstones"] })] }),
      }),
    });
    expect(gaps[0]!.condition).toBe("api-browser-disagreement");
    expect(gaps[0]!.fields).toEqual(["param:include_tombstones"]);
  });

  it("names both surfaces on a disagreement, so a reader knows which two answered", () => {
    const gaps = disagreementGaps({
      at: AT,
      comparisons: compareSurfaces({
        entities: matched({ calls: [capturedCall({ paramNames: ["channel", "include_tombstones"] })] }),
      }),
    });
    expect(gaps[0]!.surfaces).toEqual(["api", "browser"]);
  });

  it("raises browser-surface-unreadable for a browser-only method, not a disagreement", () => {
    const gaps = disagreementGaps({
      at: AT,
      comparisons: compareSurfaces({ entities: matched({ calls: [capturedCall({ name: "client.counts" })] }) }),
    });
    const browserOnly = gaps.find((gap) => gap.scope === "client.counts")!;
    expect(browserOnly.condition).toBe("browser-surface-unreadable");
    expect(browserOnly.surfaces).toEqual(["browser"]);
  });

  it("raises nothing when the surfaces agree exactly", () => {
    const agreeing = matched({
      calls: [
        capturedCall({ body: { messages: [{ text: "x", ts: "1.2" }], ok: true }, paramNames: ["channel", "limit"] }),
      ],
    });
    const rows = compareSurfaces({ entities: agreeing });
    expect(rows[0]!.paramsBrowserOnly).toEqual([]);
    expect(disagreementGaps({ at: AT, comparisons: rows }).map((gap) => gap.condition)).toEqual([]);
  });
});

describe("summariseDisagreements", () => {
  it("counts every surface outcome, including the ones that agree", () => {
    const rows = compareSurfaces({
      entities: matched({
        calls: [capturedCall({ paramNames: ["channel", "x_undoc"] }), capturedCall({ name: "client.counts" })],
      }),
    });
    expect(summariseDisagreements({ comparisons: rows })).toEqual({
      apiOnly: 0,
      both: 1,
      browserOnly: 1,
      methods: 2,
      withUndocumentedParams: 1,
      withUndocumentedResponseFields: 0,
    });
  });

  it("reports zeroes rather than nothing for an empty comparison", () => {
    expect(summariseDisagreements({ comparisons: [] })).toEqual({
      apiOnly: 0,
      both: 0,
      browserOnly: 0,
      methods: 0,
      withUndocumentedParams: 0,
      withUndocumentedResponseFields: 0,
    });
  });
});
