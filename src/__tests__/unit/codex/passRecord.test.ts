/*
 * The pure assembly of a pass record: the plan and review scopes, and the artifact record that discloses what
 * the pass was asked to run under. No pass runs and nothing is written; each case hands in literal inputs.
 */

import { describe, expect, it } from "vitest";
import type { ReviewDiff } from "../../../codex/gitDiff.js";
import { planScope, reviewScope, toArtifactRecord } from "../../../codex/passRecord.js";
import type { PlanPassProfile, ReviewPassProfile } from "../../../codex/profiles.js";
import type { BoundedPassResult, DeadlineRuntime, ScheduledTask } from "../../../codex/runPass.js";
import type { CodexPassScope, CodexPassTree, PassBound } from "../../../codex/types.js";

const PLAN_PROFILE: PlanPassProfile = {
  id: "p2",
  mode: "plan",
  purpose: "plan the split",
  title: "P2",
  toolPolicy: "repo-investigation-allowed",
};

const REVIEW_PROFILE: ReviewPassProfile = {
  id: "r1",
  mode: "review",
  purpose: "check the split",
  title: "R1",
  toolPolicy: "diff-first-repo-and-web-allowed",
};

const DIFF: ReviewDiff = {
  baseSha: "base-sha-fixture",
  bytes: 42,
  headSha: "head-sha-fixture",
  repoRoot: "/repo/acme",
  sha256: "diff-sha-fixture",
  text: "diff --git a/x b/x\n",
};

const BOUND: PassBound = { conclusionWindowMs: 180_000, totalMs: 1_200_000, warnAfterMs: 1_020_000 };

const PASS_RESULT: BoundedPassResult = {
  attempts: [],
  observedElapsedMs: 1234,
  outcome: { kind: "no-verdict", rawFinalResponse: "", reason: "no-conclusion-in-bound", salvage: null },
};

const SCOPE: CodexPassScope = { mode: "plan", pass: "p2", promptBytes: 0, promptSha256: "prompt-sha-fixture" };

/** A runtime whose clock reads one fixed instant; nothing here schedules. */
class FixedRuntime implements DeadlineRuntime {
  nowMs(): number {
    return 0;
  }
  nowIso(): string {
    return "2026-11-08T00:00:00.000Z";
  }
  schedule(): ScheduledTask {
    return { cancel: () => {} };
  }
}

describe("planScope", () => {
  it("counts the prompt in UTF-8 bytes, not characters", () => {
    const scope = planScope({ profile: PLAN_PROFILE, prompt: "café" });
    expect(scope).toEqual({
      mode: "plan",
      pass: "p2",
      promptBytes: 5,
      promptSha256: "850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e",
    });
  });

  it("hashes an empty prompt to the empty-string sha256", () => {
    const scope = planScope({ profile: PLAN_PROFILE, prompt: "" });
    expect(scope).toEqual({
      mode: "plan",
      pass: "p2",
      promptBytes: 0,
      promptSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  });
});

describe("reviewScope", () => {
  it("names the diff it judged by its base, head, size and hash", () => {
    const property = { id: "r1-01", statement: "the move is byte-identical" };
    expect(reviewScope({ baseRef: "origin/main", diff: DIFF, profile: REVIEW_PROFILE, property })).toEqual({
      baseRef: "origin/main",
      baseSha: "base-sha-fixture",
      diffBytes: 42,
      diffSha256: "diff-sha-fixture",
      headSha: "head-sha-fixture",
      mode: "review",
      pass: "r1",
      property: { id: "r1-01", statement: "the move is byte-identical" },
    });
  });
});

describe("toArtifactRecord", () => {
  const base = {
    artifactId: "artifact-fixture",
    bound: BOUND,
    passResult: PASS_RESULT,
    repoRoot: "/repo/acme",
    requestedModel: "gpt-5.6-sol",
    runtime: new FixedRuntime(),
    scope: SCOPE,
  };

  it("discloses the locked policy and the prepared workspace as the one writable root", () => {
    const record = toArtifactRecord({ ...base, tree: undefined, workspace: "/scratch/artifact-fixture" });
    expect(record).toEqual({
      artifactId: "artifact-fixture",
      attempts: [],
      bound: BOUND,
      createdAtIso: "2026-11-08T00:00:00.000Z",
      observedElapsedMs: 1234,
      outcome: PASS_RESULT.outcome,
      repoRoot: "/repo/acme",
      requestedApprovalPolicy: "never",
      requestedModel: "gpt-5.6-sol",
      requestedNetworkAccess: true,
      requestedReasoningEffort: "medium",
      requestedSandboxMode: "workspace-write",
      requestedWebSearch: true,
      requestedWritableRoots: ["/scratch/artifact-fixture"],
      schemaVersion: 1,
      scope: SCOPE,
    });
  });

  it("claims no writable root when no workspace was prepared", () => {
    const record = toArtifactRecord({ ...base, tree: undefined, workspace: null });
    expect(record.requestedWritableRoots).toEqual([]);
  });

  it("carries the tree only when one was captured", () => {
    const tree: CodexPassTree = {
      branch: "split-acme",
      dirtyBytes: 0,
      fingerprint: "fingerprint-fixture",
      headSha: "head-sha-fixture",
    };
    expect(toArtifactRecord({ ...base, tree, workspace: null }).tree).toEqual(tree);
    expect(Object.keys(toArtifactRecord({ ...base, tree: undefined, workspace: null }))).not.toContain("tree");
  });
});
