/*
 * The Slack atlas's gap reconciliation, read directly: a method disagreement opening and closing across two
 * runs, and a page the walk could not reach or that this credential cannot open.
 */
import { describe, expect, it } from "vitest";

import { reconcileMethodGaps, reconcilePageGaps } from "../../../../atlas/slackApi/atlasGaps.js";
import type { SlackAtlasGap } from "../../../../atlas/slackApi/atlasModel.js";
import type { SurfaceComparison } from "../../../../atlas/slackApi/disagreement.js";
import { unwrap } from "../../../../lib/result.js";

import { drivenPage } from "./slackAtlasFixtures.js";

const AT = "2026-08-31T09:00:00.000Z";
const EARLIER = "2026-08-30T09:00:00.000Z";
const NO_GAPS: readonly SlackAtlasGap[] = [];

/** One method both surfaces saw, with the browser-only parameters a test names. */
function comparison({ paramsBrowserOnly }: { paramsBrowserOnly: readonly string[] }): SurfaceComparison {
  return {
    callCount: 1,
    method: "conversations.history",
    paramsBrowserOnly,
    pathsApiOnly: [],
    pathsBrowserOnly: [],
    verdict: "both",
  };
}

describe("reconcileMethodGaps", () => {
  it("opens a disagreement gap for a parameter only the web client sent", () => {
    const gaps = unwrap(
      reconcileMethodGaps({ at: AT, comparisons: [comparison({ paramsBrowserOnly: ["x_undoc"] })], stored: NO_GAPS }),
    );
    expect(gaps.map((gap) => [gap.condition, gap.scope, gap.status, gap.kind])).toEqual([
      ["api-browser-disagreement", "conversations.history", "open", "method"],
    ]);
    expect(gaps[0]!.fields).toEqual(["param:x_undoc"]);
  });

  it("closes that gap on a later run where the two surfaces agree", () => {
    const first = unwrap(
      reconcileMethodGaps({
        at: EARLIER,
        comparisons: [comparison({ paramsBrowserOnly: ["x_undoc"] })],
        stored: NO_GAPS,
      }),
    );
    const second = unwrap(
      reconcileMethodGaps({ at: AT, comparisons: [comparison({ paramsBrowserOnly: [] })], stored: first }),
    );
    expect(second.map((gap) => [gap.condition, gap.status, gap.firstDetectedAt])).toEqual([
      ["api-browser-disagreement", "closed", EARLIER],
    ]);
  });
});

describe("reconcilePageGaps", () => {
  it("raises a browser-surface-unreadable gap carrying the walk's own reason", () => {
    const gaps = unwrap(
      reconcilePageGaps({
        at: AT,
        session: {
          pages: [],
          unreachable: [{ path: "/client/<team>/browse-lists", reason: "404" }],
          workspaceId: "T0SYN1ABCDEFGH",
        },
        stored: NO_GAPS,
        walked: [drivenPage()],
      }),
    );
    expect(
      gaps
        .filter((gap) => gap.condition === "browser-surface-unreadable")
        .map((gap) => [gap.scope, gap.reason, gap.surfaces]),
    ).toEqual([["/client/<team>/browse-lists", "404", ["browser"]]]);
  });

  it("names the missing admin entitlement for an admin page the walk did not stand on", () => {
    const gaps = unwrap(
      reconcilePageGaps({
        at: AT,
        session: { pages: [], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" },
        stored: NO_GAPS,
        walked: [drivenPage()],
      }),
    );
    const admin = gaps.find((gap) => gap.scope === "/<workspace>/admin")!;
    expect([admin.condition, admin.status, admin.kind]).toEqual(["admin-entitlement-missing", "open", "page"]);
    expect(admin.reason).toBe(
      "/<workspace>/admin needs a workspace or organisation admin role, and the walk's signed-in session did not reach it",
    );
  });
});
