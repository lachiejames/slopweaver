/* Which enqueue findings still stand once the caller has acknowledged some, or all, of them. */
import { describe, expect, it } from "vitest";

import {
  enqueueFindings,
  unacknowledgedEnqueueFindings,
} from "../../../../../../cli/commands/github/enqueueFindings.js";
import { ORDINARY, PAIRED, pr } from "./fixtures.js";

describe("unacknowledgedEnqueueFindings", () => {
  const findings = enqueueFindings({
    target: ORDINARY,
    inspection: PAIRED,
    pr: pr({
      checks: {
        baseRef: "main",
        checks: [],
        headSha: "cafe1234",
        mergeable: undefined,
        residue: [],
        rollupState: "FAILURE",
        supersededChecks: [],
        truncated: false,
      },
      reviewDecision: "REVIEW_REQUIRED",
    }),
    requiredContexts: [],
    requiresCodeOwnerReviews: undefined,
  });

  it("keeps every finding when nothing is acknowledged", () => {
    expect(unacknowledgedEnqueueFindings({ acknowledge: [], acknowledgeAll: false, findings }).length).toBe(2);
  });

  it("drops exactly the named subject", () => {
    const left = unacknowledgedEnqueueFindings({ acknowledge: ["ci-not-green"], acknowledgeAll: false, findings });
    expect(left.map((finding) => finding.subject)).toEqual(["review-not-approved"]);
  });

  it("drops everything under --acknowledge-all", () => {
    expect(unacknowledgedEnqueueFindings({ acknowledge: [], acknowledgeAll: true, findings })).toEqual([]);
  });
});
