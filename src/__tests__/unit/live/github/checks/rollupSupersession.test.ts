/**
 * The rollup-supersession judgements — `rollupContradictsChecks`, `supersededFailures` and
 * `rollupSupersessionProof`: when a FAILURE rollup disagrees with an all-passed latest-per-name view, and
 * whether the superseded runs in the read prove that disagreement away.
 */
import { describe, expect, it } from "vitest";

import { type GithubChecksSnapshot, summarizeChecks } from "../../../../../live/github/checks.js";
import type { GithubCheck, SupersededGithubCheck } from "../../../../../live/github/checksDedupe.js";
import {
  type RollupSupersessionProof,
  rollupContradictsChecks,
  rollupSupersessionProof,
  supersededFailures,
} from "../../../../../live/github/rollupSupersession.js";
import { checksSnapshot } from "./harness.js";

describe("rollupContradictsChecks", () => {
  const green = [{ kind: "check-run", name: "dev-gate", state: "passed", url: undefined }] as const;
  const allPassed = { failed: 0, passed: 1, queued: 0, running: 0, total: 1 };

  it("holds when a settled all-passed head carries a FAILURE rollup", () => {
    expect(
      rollupContradictsChecks({
        snapshot: checksSnapshot({ checks: green, rollupState: "FAILURE" }),
        summary: allPassed,
      }),
    ).toBe(true);
  });

  it("does not hold for a PENDING rollup, which has merely not caught up", () => {
    expect(
      rollupContradictsChecks({
        snapshot: checksSnapshot({ checks: green, rollupState: "PENDING" }),
        summary: allPassed,
      }),
    ).toBe(false);
  });

  it("does not hold while the count itself still names a failure", () => {
    expect(
      rollupContradictsChecks({
        snapshot: checksSnapshot({ checks: green, rollupState: "FAILURE" }),
        summary: { failed: 1, passed: 1, queued: 0, running: 0, total: 2 },
      }),
    ).toBe(false);
  });

  it("does not hold on a commit with no checks at all", () => {
    expect(
      rollupContradictsChecks({
        snapshot: checksSnapshot({ rollupState: "FAILURE" }),
        summary: { failed: 0, passed: 0, queued: 0, running: 0, total: 0 },
      }),
    ).toBe(false);
  });
});

describe("supersededFailures", () => {
  it("keeps only the discards that failed, so a passing discard explains nothing", () => {
    const failure: SupersededGithubCheck = {
      completedAt: "2026-09-05T06:11:44Z",
      kind: "check-run",
      name: "dev-gate",
      replacedBy: undefined,
      runId: "33945158665",
      state: "failed",
    };
    const snapshot = checksSnapshot({
      supersededChecks: [
        {
          completedAt: undefined,
          kind: "check-run",
          name: "build",
          replacedBy: undefined,
          runId: "1",
          state: "passed",
        },
        failure,
      ],
    });

    expect(supersededFailures({ snapshot })).toEqual([failure]);
  });
});

describe("rollupSupersessionProof", () => {
  /** A `dev-gate` failure on the head, replaced by a later run of its own name that passed. */
  const REPLACED: SupersededGithubCheck = {
    completedAt: "2026-09-03T05:11:44Z",
    kind: "check-run",
    name: "dev-gate",
    replacedBy: { completedAt: "2026-09-03T05:31:00Z", runId: "33717812345", state: "passed" },
    runId: "33717795965",
    state: "failed",
  };
  const GREEN: readonly GithubCheck[] = [{ kind: "check-run", name: "dev-gate", state: "passed", url: undefined }];
  /** The count every caller derives from the snapshot it is judging, so each case states only the snapshot. */
  const proofFor = ({ snapshot }: { snapshot: GithubChecksSnapshot }): RollupSupersessionProof =>
    rollupSupersessionProof({ snapshot, summary: summarizeChecks({ checks: snapshot.checks }) });

  it("is absent when the rollup and the latest-per-name view agree, so there is nothing to answer", () => {
    expect(proofFor({ snapshot: checksSnapshot({ checks: GREEN, rollupState: "SUCCESS" }) })).toEqual({
      kind: "absent",
    });
  });

  it("is absent on a snapshot carrying no checks at all, which proves nothing either way", () => {
    expect(proofFor({ snapshot: checksSnapshot({ rollupState: "FAILURE" }) })).toEqual({
      kind: "absent",
    });
  });

  it("proves the replacement, naming the run that took the failure's slot and when it finished", () => {
    const proof = proofFor({
      snapshot: checksSnapshot({ checks: GREEN, rollupState: "FAILURE", supersededChecks: [REPLACED] }),
    });

    expect(proof.kind).toBe("proven");
    expect(proof).toEqual({
      kind: "proven",
      reason:
        "GitHub's rollup on abc123 reads FAILURE and all 1 checks in the latest-per-name view on that head " +
        "PASSED; every run pinning it was replaced on the same head by a later run of its own name — " +
        "dev-gate 33717795965 completed 05:11:44Z superseded by run 33717812345 completed 05:31:00Z",
    });
  });

  it("refuses a TRUNCATED read, where a failing check may simply not have arrived", () => {
    const proof = proofFor({
      snapshot: checksSnapshot({
        checks: GREEN,
        rollupState: "FAILURE",
        supersededChecks: [REPLACED],
        truncated: true,
      }),
    });

    expect(proof).toEqual({
      kind: "unproven",
      why:
        "the head carries more check contexts than this read's page returned, so a failing check may be " +
        "missing from the 1 that arrived",
    });
  });

  it("refuses when nothing in the read explains the failing rollup", () => {
    const proof = proofFor({
      snapshot: checksSnapshot({ checks: GREEN, rollupState: "FAILURE" }),
    });

    expect(proof).toEqual({
      kind: "unproven",
      why: "nothing in this read explains the FAILURE rollup — no superseded run on abc123 failed",
    });
  });

  it("refuses an UNORDERED pinning failure, the case a rollup-only test would have waved through", () => {
    const proof = proofFor({
      snapshot: checksSnapshot({
        checks: GREEN,
        rollupState: "FAILURE",
        supersededChecks: [
          REPLACED,
          {
            completedAt: undefined,
            kind: "check-run",
            name: "lint",
            replacedBy: undefined,
            runId: "99",
            state: "failed",
          },
        ],
      }),
    });

    expect(proof).toEqual({
      kind: "unproven",
      why:
        "1 of 2 superseded failure(s) on abc123 carry no LATER run of the same name this read can name: " + "lint 99",
    });
  });
});
