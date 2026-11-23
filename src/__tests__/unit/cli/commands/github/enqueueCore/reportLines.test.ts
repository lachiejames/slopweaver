/* The findings report the enqueue door prints: clean, acknowledged or unacknowledged, each with its remedy. */
import { describe, expect, it } from "vitest";

import {
  enqueueFindings,
  enqueueRemedyFor,
  enqueueReportLines,
} from "../../../../../../cli/commands/github/enqueueFindings.js";
import { ORDINARY, PAIRED, pr } from "./fixtures.js";

describe("enqueueReportLines", () => {
  it("says so when nothing stands in the way", () => {
    expect(enqueueReportLines({ stacked: false, acknowledge: [], acknowledgeAll: false, findings: [] })).toEqual([
      "clean: nothing stands between this pull request and its base branch's merge queue.",
    ]);
  });

  it("prints an acknowledged finding, marked as accepted rather than hidden", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    const lines = enqueueReportLines({
      stacked: false,
      acknowledge: ["not-mergeable"],
      acknowledgeAll: false,
      findings,
    });
    expect(lines[0]).toBe("  [ACKNOWLEDGED] not-mergeable");
    expect(lines[2]).toBe(`      remedy: ${enqueueRemedyFor({ kind: "not-mergeable" })}`);
  });

  it("marks an unacknowledged finding as such", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    const lines = enqueueReportLines({ stacked: false, acknowledge: [], acknowledgeAll: false, findings });
    expect(lines[0]).toBe("  [UNACKNOWLEDGED] not-mergeable");
  });
});
