/* The enqueue door's not-mergeable finding, and the stable order every finding is raised in. */
import { describe, expect, it } from "vitest";

import { enqueueFindings } from "../../../../../../cli/commands/github/enqueueFindings.js";
import { ORDINARY, PAIRED, pr } from "./fixtures.js";

describe("enqueueFindings", () => {
  it("raises not-mergeable for a conflicting pull request", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("not-mergeable");
    expect(findings[0]!.detail).toContain("as CONFLICTING against main");
  });

  it("raises not-mergeable while GitHub is still computing mergeability", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ mergeable: "UNKNOWN" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings[0]!.detail).toContain("has not finished computing");
  });

  it("raises all three at once, in a stable order", () => {
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
        mergeable: "CONFLICTING",
        reviewDecision: "CHANGES_REQUESTED",
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toEqual([
      "ci-not-green",
      "review-not-approved",
      "not-mergeable",
    ]);
  });
});
