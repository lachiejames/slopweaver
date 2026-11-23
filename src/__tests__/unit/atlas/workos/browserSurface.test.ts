/**
 * The walk document's contract, and the refusal that makes it worth having.
 *
 * MEASURED: every unauthenticated dashboard path answers the same sign-in redirect, so an
 * unsigned walk would report every declared page as unreachable — one confident wrong answer about
 * WorkOS per declared page. The `signedIn` refusal is the whole reason this atlas's walk document differs from every other
 * one's, so it is the first thing tested.
 */
import { describe, expect, it } from "vitest";

import {
  parseWorkosWalkDocument,
  projectWalkedPages,
  type WorkosWalkDocument,
  workosWalkBrief,
} from "../../../../atlas/workos/browserSurface.js";
import type { WorkosPageDetail } from "../../../../atlas/workos/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { AT } from "./workosFixtures.js";

/** A minimal valid walk document. */
function document({ signedIn = true, reached = true }: { signedIn?: boolean; reached?: boolean } = {}): unknown {
  return {
    pages: [
      {
        finalUrl: "https://dashboard.workos.com/organizations",
        providerId: "/organizations",
        reached,
        requestedUrl: "https://dashboard.workos.com/organizations",
        screenshotPath: null,
        statusCode: 200,
        title: "Organizations",
        unreachableBecause: reached ? null : "landed on /signin",
      },
    ],
    signedIn,
    walkedAt: AT,
  };
}

describe("parseWorkosWalkDocument", () => {
  it("accepts a signed-in walk", () => {
    const parsed = parseWorkosWalkDocument({ json: document() });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).pages.length).toBe(1);
  });

  it("REFUSES an unsigned walk, because its every page is a false finding about WorkOS", () => {
    const parsed = parseWorkosWalkDocument({ json: document({ signedIn: false }) });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("not signed in");
  });

  it("refuses a document that omits signedIn rather than assuming it", () => {
    const parsed = parseWorkosWalkDocument({ json: { pages: [], walkedAt: AT } });
    expect(unwrapErr(parsed)).toEqual([
      "walk document: pages Too small: expected array to have >=1 items",
      "walk document: signedIn Invalid input: expected boolean, received undefined",
    ]);
  });

  it("refuses a document carrying no pages at all", () => {
    const parsed = parseWorkosWalkDocument({ json: { pages: [], signedIn: true, walkedAt: AT } });
    expect(unwrapErr(parsed)).toEqual(["walk document: pages Too small: expected array to have >=1 items"]);
  });

  it("refuses an unknown field rather than silently dropping it", () => {
    const parsed = parseWorkosWalkDocument({ json: { ...(document() as object), extra: 1 } });
    expect(unwrapErr(parsed)).toEqual(['walk document:  Unrecognized key: "extra"']);
  });
});

describe("workosWalkBrief", () => {
  it("opens with the sign-in check, before any declared address", () => {
    const brief = workosWalkBrief({
      finish: "slopweaver atlas workos walk --observation <path>",
      pages: [
        {
          providerId: "/organizations",
          purpose: "the organisations",
          url: "https://dashboard.workos.com/organizations",
        },
      ],
    });
    expect(brief.steps[0]?.what).toContain("confirm you are SIGNED IN");
  });

  it("names one step per declared address after the check", () => {
    const brief = workosWalkBrief({
      finish: "finish",
      pages: [
        { providerId: "/a", purpose: "a", url: "https://dashboard.workos.com/a" },
        { providerId: "/b", purpose: "b", url: "https://dashboard.workos.com/b" },
      ],
    });
    expect(brief.steps.length).toBe(3);
    expect(brief.steps[1]?.what).toContain("https://dashboard.workos.com/a");
  });

  it("carries the invocation that judges the document back", () => {
    const brief = workosWalkBrief({ finish: "finish-here", pages: [] });
    expect(brief.finish).toBe("finish-here");
  });
});

describe("projectWalkedPages", () => {
  const parsed = (): WorkosWalkDocument => unwrap(parseWorkosWalkDocument({ json: document() }));

  it("stamps reachedAt from the WALK's own instant rather than the publish's", () => {
    const entity = projectWalkedPages({ at: "2026-09-06T00:00:00.000Z", document: parsed(), screenshots: [] })[0]!;
    expect((entity.channels.browser!.detail as WorkosPageDetail).reachedAt).toBe(AT);
  });

  it("earns browser-discovered, which only an opened address may claim", () => {
    const entity = projectWalkedPages({ at: AT, document: parsed(), screenshots: [] })[0]!;
    expect(entity.channels.browser?.source?.deepLinkStatus).toBe("browser-discovered");
  });

  it("attaches a screenshot to the page it belongs to", () => {
    const artifact = {
      byteLength: 3,
      kind: "page-png" as const,
      mediaType: "image/png",
      relativePath: "artifacts/pages/aa.png",
      sha256: "a".repeat(64),
    };
    const entity = projectWalkedPages({
      at: AT,
      document: parsed(),
      screenshots: [{ artifact, providerId: "/organizations" }],
    })[0]!;
    expect(entity.channels.browser?.source?.artifacts).toEqual([artifact]);
  });

  it("records an unreached page as a page with a reason, never as an absence", () => {
    const unreached = unwrap(parseWorkosWalkDocument({ json: document({ reached: false }) }));
    const entity = projectWalkedPages({ at: AT, document: unreached, screenshots: [] })[0]!;
    const detail = entity.channels.browser!.detail as WorkosPageDetail;
    expect(detail.reachedAt).toBe(null);
    expect(detail.unreachableBecause).toBe("landed on /signin");
  });
});
