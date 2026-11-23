/*
 * The gaps one Aether walk raises: the standing pair on every read walk, each shortfall only when its count is
 * above zero, and the single sign-in-wall gap on a signed-out walk.
 */
import { describe, expect, it } from "vitest";

import type { AetherReduction } from "../../../../atlas/aether/reduction.js";
import type { AetherPageObservation, AetherWalkResult } from "../../../../atlas/aether/walk.js";
import { loginWallGaps, walkGaps } from "../../../../atlas/aether/walkGaps.js";

const AT = "2026-09-15T12:00:00.000Z";

/** One page observation, landed unless the caller overrides it. */
function page({ href, over = {} }: { href: string; over?: Partial<AetherPageObservation> }): AetherPageObservation {
  return {
    artifacts: [],
    finalUrl: `https://app.tryaether.ai${href}`,
    href,
    outcome: "landed",
    rendered: true,
    responseCount: 0,
    section: "s",
    statusCode: 200,
    title: "Aether",
    ...over,
  };
}

/** A one-page landed walk, with every shortfall list empty unless the caller overrides it. */
function walkOf({ over = {} }: { over?: Partial<AetherWalkResult> }): AetherWalkResult {
  return {
    artifactsWritten: 0,
    finalUrls: [],
    incompletePages: [],
    loginWallPages: [],
    notAttempted: [],
    pages: [page({ href: "/home" })],
    responses: [],
    unrenderedPages: [],
    ...over,
  };
}

const CLEAN_REDUCTION: AetherReduction = { findings: [], projects: [], unprojectable: [] };

describe("walkGaps", () => {
  it("raises only the standing pair when the walk had no shortfall", () => {
    const gaps = walkGaps({ at: AT, reduction: CLEAN_REDUCTION, walk: walkOf({}) });
    expect(gaps.map((gap) => [gap.condition, gap.kind, gap.scope])).toEqual([
      ["report-print-only", "finding", "risk-report"],
      ["no-shot-adapter", "page", "aether-portal"],
    ]);
    expect(gaps.map((gap) => gap.status)).toEqual(["open", "open"]);
    expect(gaps.map((gap) => gap.firstDetectedAt)).toEqual([AT, AT]);
  });

  it("raises page-unreachable for a failed route but not for a sign-in-wall one", () => {
    const walk = walkOf({
      over: {
        pages: [
          page({ href: "/home" }),
          page({ href: "/risk-inbox", over: { outcome: "failed" } }),
          page({ href: "/settings", over: { outcome: "login-wall" } }),
        ],
      },
    });
    const unreachable = walkGaps({ at: AT, reduction: CLEAN_REDUCTION, walk }).find(
      (gap) => gap.condition === "page-unreachable",
    )!;
    expect(unreachable.fields).toEqual(["/risk-inbox"]);
    expect(unreachable.reason).toBe("1 of 3 declared route(s) did not render");
    expect(unreachable.surfaces).toEqual(["aether-portal"]);
  });

  it("raises each list-backed shortfall in table order, and caps schema-drift's fields at eight", () => {
    const unprojectable = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const walk = walkOf({ over: { incompletePages: ["/findings"], unrenderedPages: ["/home", "/projects"] } });
    const gaps = walkGaps({ at: AT, reduction: { ...CLEAN_REDUCTION, unprojectable }, walk });
    expect(gaps.map((gap) => gap.condition)).toEqual([
      "report-print-only",
      "no-shot-adapter",
      "page-unphotographed",
      "response-body-lost",
      "schema-drift",
    ]);
    const unphotographed = gaps.find((gap) => gap.condition === "page-unphotographed")!;
    expect(unphotographed.fields).toEqual(["/home", "/projects"]);
    expect(unphotographed.reason).toBe("2 route(s) were reached but photographed mid-load");
    const drift = gaps.find((gap) => gap.condition === "schema-drift")!;
    expect(drift.fields).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(drift.reason).toBe(
      "10 finding-anchored object(s) carried a severity or state this atlas does not know, so they were not stored",
    );
  });
});

describe("loginWallGaps", () => {
  it("raises the one cross-kind login-wall gap naming every walled route", () => {
    const gaps = loginWallGaps({ at: AT, walk: walkOf({ over: { loginWallPages: ["/home", "/risk-inbox"] } }) });
    expect(gaps.length).toBe(1);
    const gap = gaps[0]!;
    expect(gap.condition).toBe("login-wall");
    expect(gap.kind).toBe(null);
    expect(gap.fields).toEqual(["/home", "/risk-inbox"]);
    expect(gap.scope).toBe("aether-portal");
    expect([gap.firstDetectedAt, gap.lastDetectedAt, gap.lastCheckedAt]).toEqual([AT, AT, AT]);
  });
});
