/*
 * The detail a walked page's entity carries for each outcome: fully held, reached without a picture, behind a
 * sign-in wall, or never visited.
 */
import { describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../../atlas/kit/browserWalk.js";
import { frontierPageDetail } from "../../../../../atlas/kit/frontierPageDetail.js";
import { renderedPng } from "../../../../pngFixture.js";

import { BASE, explain, observation } from "./harness.js";

describe("frontierPageDetail", () => {
  const shot = screenshotArtifact({ bytes: renderedPng({ seed: 2 }), directory: "shots" });

  it("describes a landed, photographed page as fully held", () => {
    const page = observation({ over: { artifacts: [shot] } });
    const detail = frontierPageDetail({ callCount: 3, captureComplete: true, explain, page });

    expect(detail).toEqual({
      callCount: 3,
      captureComplete: true,
      finalUrl: `${BASE}/home`,
      redirected: false,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 3 },
      screenshotMissingBecause: null,
      statusCode: 200,
      title: "Home",
      unreachableBecause: null,
    });
    expect(detail.responseAccounting).not.toBe(page.responseAccounting);
  });

  it("holds a reached page with no picture as reached, with only its screenshot missing", () => {
    const detail = frontierPageDetail({
      callCount: 0,
      captureComplete: true,
      explain,
      page: observation({ over: { outcome: "unphotographed" } }),
    });

    expect(detail.unreachableBecause).toBe(null);
    expect(detail.screenshotMissingBecause).toBe("why unphotographed");
    expect(detail.redirected).toBe(false);
  });

  it("counts a sign-in wall as a redirect and as unreachable", () => {
    const detail = frontierPageDetail({
      callCount: 0,
      captureComplete: true,
      explain,
      page: observation({ over: { artifacts: [shot], finalUrl: `${BASE}/login`, outcome: "signed-out" } }),
    });

    expect(detail.redirected).toBe(true);
    expect(detail.unreachableBecause).toBe("why signed-out");
    expect(detail.screenshotMissingBecause).toBe(null);
  });

  it("says a page that was never visited was not visited, rather than leaving an empty address", () => {
    const detail = frontierPageDetail({
      callCount: 0,
      captureComplete: false,
      explain,
      page: observation({ over: { finalUrl: null, outcome: "failed", statusCode: null, title: null } }),
    });

    expect(detail.finalUrl).toBe("not-visited");
    expect(detail.redirected).toBe(false);
    expect(detail.unreachableBecause).toBe("why failed");
    expect(detail.screenshotMissingBecause).toBe("why failed");
  });
});
