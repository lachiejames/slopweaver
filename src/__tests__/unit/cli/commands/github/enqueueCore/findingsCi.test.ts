/*
 * The enqueue door's CI findings: a required context that never ran, a red or still-running head, an
 * advisory-only red the queue does not gate on, and a rollup a superseded run pins red.
 */
import { describe, expect, it } from "vitest";

import {
  enqueueFindings,
  enqueueRemedyFor,
  unacknowledgedEnqueueFindings,
} from "../../../../../../cli/commands/github/enqueueFindings.js";
import { ORDINARY, PAIRED, PASSING, pr } from "./fixtures.js";

describe("enqueueFindings", () => {
  it("raises nothing against a green, approved, mergeable pull request", () => {
    expect(
      enqueueFindings({
        target: ORDINARY,
        inspection: PAIRED,
        pr: pr(),
        requiredContexts: [],
        requiresCodeOwnerReviews: undefined,
      }),
    ).toEqual([]);
  });

  it("raises required-context-missing on a rollup-SUCCESS head whose required context never ran", () => {
    // The measured shape: `main` requires build + integration; a CONFLICTING pull request runs neither while
    // CodeQL still passes, so the rollup reads SUCCESS with nothing failing, running or queued.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [{ kind: "check-run", name: "CodeQL", state: "passed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "SUCCESS",
          supersededChecks: [],
          truncated: false,
        },
      }),
      requiredContexts: ["build", "integration"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("required-context-missing");
    expect(findings[0]!.detail).toContain("main requires build, integration");
    expect(findings[0]!.detail).toContain("not on this head at all");
  });

  it("raises nothing about required contexts when every required name is on the head", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [
            { kind: "check-run", name: "build", state: "passed", url: undefined },
            { kind: "check-run", name: "integration", state: "passed", url: undefined },
          ],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "SUCCESS",
          supersededChecks: [],
          truncated: false,
        },
      }),
      requiredContexts: ["build", "integration"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings).toEqual([]);
  });

  it("raises ci-not-green with the counts and the failing check names", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "typecheck", state: "failed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("ci-not-green");
    expect(findings[0]!.detail).toContain("reads FAILURE");
    expect(findings[0]!.detail).toContain("1/2 passed, 1 failed");
    expect(findings[0]!.detail).toContain("failed: typecheck");
  });

  it("raises nothing over an advisory-only red the queue does not gate on (a measured acme-admin case)", () => {
    // The measured shape: staging requires two contexts, both passed, and three advisory E2E lanes failed.
    // GitHub read it UNSTABLE and would have queued it; this door refused it on ci-not-green for four days.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "staging",
          checks: [
            { kind: "check-run", name: "Required CI", state: "passed", url: undefined },
            { kind: "check-run", name: "Advisory local browser E2E (1)", state: "failed", url: undefined },
            { kind: "check-run", name: "Advisory local browser E2E (2)", state: "failed", url: undefined },
          ],
          headSha: "c35f9733",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
        githubMergeStatus: { kind: "mergeable", status: "UNSTABLE" },
      }),
      requiredContexts: ["Required CI"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings).toEqual([]);
  });

  it("still raises ci-not-green over a red dev-gate, which gates landing though no branch rule can require it", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "dev-gate", state: "failed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
      }),
      requiredContexts: ["build"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toEqual(["ci-not-green"]);
    expect(findings[0]!.detail).toContain("failed: dev-gate");
  });

  it("still raises ci-not-green over a red whose required set was read truncated", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "e2e", state: "failed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: true,
        },
      }),
      requiredContexts: ["build"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toEqual(["ci-not-green"]);
  });

  it("raises ci-not-green while a check is still running, even with a SUCCESS rollup", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "e2e", state: "running", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "SUCCESS",
          supersededChecks: [],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.detail).toContain("1 still running");
  });

  it("raises ci-rollup-superseded, not ci-not-green, when a replaced run pins a green head's rollup", () => {
    // The measured shape, and the one this repository's own landing sequence produces: `github push`
    // amends the commit, repointing the proof anchor re-triggers dev-gate, and the run that failed against
    // the stale anchor stays folded into the rollup for the same head.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "dev-gate", state: "passed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [
            {
              completedAt: "2026-09-05T06:11:44Z",
              kind: "check-run",
              name: "dev-gate",
              replacedBy: undefined,
              runId: "33945158665",
              state: "failed",
            },
          ],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("ci-rollup-superseded");
    expect(findings[0]!.detail).toContain("all 2 checks on that head PASSED");
    expect(findings[0]!.detail).toContain("dev-gate 33945158665 completed 06:11:44Z");
  });

  it("leaves ci-rollup-superseded unacknowledged when only ci-not-green was accepted", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [
            {
              completedAt: undefined,
              kind: "check-run",
              name: "dev-gate",
              replacedBy: undefined,
              runId: undefined,
              state: "failed",
            },
          ],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    const left = unacknowledgedEnqueueFindings({ acknowledge: ["ci-not-green"], acknowledgeAll: false, findings });
    expect(left.length).toBe(1);
    expect(left[0]!.subject).toBe("ci-rollup-superseded");
    expect(
      unacknowledgedEnqueueFindings({ acknowledge: ["ci-rollup-superseded"], acknowledgeAll: false, findings }),
    ).toEqual([]);
  });

  it("keeps ci-not-green when a green head's failing rollup has no superseded failure behind it", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [
            {
              completedAt: undefined,
              kind: "check-run",
              name: "build",
              replacedBy: undefined,
              runId: "1",
              state: "passed",
            },
          ],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("ci-not-green");
  });

  it("keeps ci-not-green when a check is still failing on the head, superseded runs and all", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        checks: {
          baseRef: "main",
          checks: [PASSING, { kind: "check-run", name: "typecheck", state: "failed", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [
            {
              completedAt: undefined,
              kind: "check-run",
              name: "dev-gate",
              replacedBy: undefined,
              runId: "1",
              state: "failed",
            },
          ],
          truncated: false,
        },
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("ci-not-green");
    expect(findings[0]!.detail).toContain("failed: typecheck");
  });

  it("names a remedy that points ci-rollup-superseded away from the ci-not-green subject", () => {
    expect(enqueueRemedyFor({ kind: "ci-rollup-superseded" })).toContain("never `ci-not-green`");
  });
});
