import { describe, expect, it } from "vitest";

import {
  type HiveWalkDocument,
  hiveWalkBrief,
  parseHiveWalkDocument,
  projectWalkedPages,
} from "../../../../atlas/graphqlHive/browserSurface.js";
import type { HivePageDetail } from "../../../../atlas/graphqlHive/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { AT } from "./hiveFixtures.js";

/** One walk document, with whichever page rows a test needs. */
function document({ pages }: { pages: HiveWalkDocument["pages"] }): HiveWalkDocument {
  return { pages, walkedAt: AT };
}

/** One page row, defaulted to a clean reach. */
function page({
  providerId,
  reached = true,
  screenshotPath = null,
  unreachableBecause = null,
}: {
  providerId: string;
  reached?: boolean;
  screenshotPath?: string | null;
  unreachableBecause?: string | null;
}): HiveWalkDocument["pages"][number] {
  return {
    finalUrl: `https://app.graphql-hive.com${providerId}`,
    providerId,
    reached,
    requestedUrl: `https://app.graphql-hive.com${providerId}`,
    screenshotPath,
    statusCode: reached ? 200 : 403,
    title: reached ? "Hive" : null,
    unreachableBecause,
  };
}

describe("parseHiveWalkDocument", () => {
  it("accepts a well-formed document", () => {
    const parsed = parseHiveWalkDocument({ json: document({ pages: [page({ providerId: "/" })] }) });
    expect(unwrap(parsed).pages.length).toBe(1);
  });

  it("refuses a document carrying no pages, which would publish a walk that walked nothing", () => {
    const parsed = parseHiveWalkDocument({ json: { pages: [], walkedAt: AT } });
    expect(unwrapErr(parsed)).toEqual(["walk document: pages Too small: expected array to have >=1 items"]);
  });

  it("refuses an unknown field rather than storing whatever a session invented", () => {
    const parsed = parseHiveWalkDocument({ json: { extra: 1, pages: [page({ providerId: "/" })], walkedAt: AT } });
    expect(unwrapErr(parsed).length).toBeGreaterThan(0);
  });

  it("refuses a requested URL that is not a URL", () => {
    const bad = { ...page({ providerId: "/" }), requestedUrl: "not a url" };
    const parsed = parseHiveWalkDocument({ json: { pages: [bad], walkedAt: AT } });
    expect(unwrapErr(parsed)).toEqual(["walk document: pages.0.requestedUrl Invalid URL"]);
  });
});

describe("hiveWalkBrief", () => {
  it("names one step per declared address, so nothing is walked that was not declared", () => {
    const brief = hiveWalkBrief({
      finish: "slopweaver atlas graphql-hive walk --observation x",
      pages: [
        { providerId: "/", purpose: "landing", url: "https://app.graphql-hive.com/" },
        { providerId: "/settings", purpose: "profile", url: "https://app.graphql-hive.com/settings" },
      ],
    });
    expect(brief.steps.length).toBe(2);
  });

  it("tells the session which provider id to write back, which is what makes the document mergeable", () => {
    const brief = hiveWalkBrief({
      finish: "x",
      pages: [{ providerId: "/settings", purpose: "profile", url: "https://app.graphql-hive.com/settings" }],
    });
    expect(brief.steps[0]!.what).toContain('providerId "/settings"');
  });
});

describe("projectWalkedPages", () => {
  it("stamps a reached page with the walk's own instant", () => {
    const entities = projectWalkedPages({
      at: AT,
      document: document({ pages: [page({ providerId: "/" })] }),
      screenshots: [],
    });
    expect((entities[0]!.channels.browser!.detail as HivePageDetail).reachedAt).toBe(AT);
  });

  it("leaves an unreached page with no reach stamp and the walk's stated reason", () => {
    const entities = projectWalkedPages({
      at: AT,
      document: document({
        pages: [page({ providerId: "/x", reached: false, unreachableBecause: "403 from the console" })],
      }),
      screenshots: [],
    });
    const detail = entities[0]!.channels.browser!.detail as HivePageDetail;
    expect(detail.unreachableBecause).toBe("403 from the console");
  });

  it("marks the address browser-discovered, which only a driven browser may write", () => {
    const entities = projectWalkedPages({
      at: AT,
      document: document({ pages: [page({ providerId: "/" })] }),
      screenshots: [],
    });
    expect(entities[0]!.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("leaves the API channel untouched, so a walk can never blank the declared page map", () => {
    const entities = projectWalkedPages({
      at: AT,
      document: document({ pages: [page({ providerId: "/" })] }),
      screenshots: [],
    });
    expect(entities[0]!.channels.api).toBeNull();
  });

  it("attaches a screenshot to the page it belongs to", () => {
    const artifact = {
      byteLength: 3,
      kind: "page-png" as const,
      mediaType: "image/png",
      relativePath: "artifacts/pages/bb.png",
      sha256: "b".repeat(64),
    };
    const entities = projectWalkedPages({
      at: AT,
      document: document({ pages: [page({ providerId: "/", screenshotPath: "/tmp/x.png" })] }),
      screenshots: [{ artifact, providerId: "/" }],
    });
    expect(entities[0]!.channels.browser!.source!.artifacts).toStrictEqual([artifact]);
  });

  it("holds a reached-but-unphotographed page with no artifact, which is a state rather than a failure", () => {
    const entities = projectWalkedPages({
      at: AT,
      document: document({ pages: [page({ providerId: "/" })] }),
      screenshots: [],
    });
    expect(entities[0]!.channels.browser!.source!.artifacts).toStrictEqual([]);
  });
});
