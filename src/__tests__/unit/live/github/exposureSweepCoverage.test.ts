import { describe, expect, it } from "vitest";

import { githubExposureSweepCoverage } from "../../../../live/github/exposureSweepCoverage.js";

const COUNTED = { count: 3, detail: "3 item(s)", kind: "counted" as const, limits: ["the API lists 300 at most"] };

describe("githubExposureSweepCoverage", () => {
  it("calls a fully read surface swept, carrying the inventory's limits then the sweep's", () => {
    expect(
      githubExposureSweepCoverage({
        result: { state: COUNTED, surface: "actions-jobs" },
        sweepGaps: [],
        sweepLimits: ["1 job log(s) GitHub no longer serves, so none will be public"],
        texts: 4,
        uploadCount: 0,
      }),
    ).toEqual({
      kind: "swept",
      limits: ["the API lists 300 at most", "1 job log(s) GitHub no longer serves, so none will be public"],
      texts: 4,
    });
  });

  it("calls a surface partial when the sweep itself left a gap, though the inventory counted it whole", () => {
    expect(
      githubExposureSweepCoverage({
        result: { state: COUNTED, surface: "file-history" },
        sweepGaps: ["2 blob(s) could not be read"],
        sweepLimits: [],
        texts: 9,
        uploadCount: 0,
      }),
    ).toEqual({ kind: "partial", texts: 9, why: ["2 blob(s) could not be read"] });
  });

  it("calls a surface whose content is never fetched not-swept once it holds anything, and swept when empty", () => {
    const empty = { count: 0, detail: "0 item(s)", kind: "counted" as const, limits: [] };
    expect(
      githubExposureSweepCoverage({
        result: { state: COUNTED, surface: "actions-artifacts" },
        sweepGaps: [],
        sweepLimits: [],
        texts: 3,
        uploadCount: 0,
      }),
    ).toEqual({ kind: "not-swept", texts: 3, why: ["artifact archives are not read; their names are"] });
    expect(
      githubExposureSweepCoverage({
        result: { state: empty, surface: "actions-artifacts" },
        sweepGaps: [],
        sweepLimits: [],
        texts: 0,
        uploadCount: 0,
      }),
    ).toEqual({ kind: "swept", limits: [], texts: 0 });
  });

  it("keeps a read failure a read failure, the sweep's gaps appended", () => {
    expect(
      githubExposureSweepCoverage({
        result: {
          state: { detail: "listing failed", kind: "read-failed", why: ["page 2 answered 502"] },
          surface: "actions-jobs",
        },
        sweepGaps: ["1 job log(s) could not be read in full"],
        sweepLimits: [],
        texts: 0,
        uploadCount: 0,
      }),
    ).toEqual({ kind: "read-failed", why: ["page 2 answered 502", "1 job log(s) could not be read in full"] });
  });
});
