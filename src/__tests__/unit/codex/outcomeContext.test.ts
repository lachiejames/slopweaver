import { describe, expect, it } from "vitest";

import { formatPassOutcomeContext } from "../../../codex/outcomeContext.js";
import type { CodexArtifactRecord, CodexAttempt, PassSalvage, PlanAnswer } from "../../../codex/types.js";

/** A minimal, fully-shaped attempt — only `kind`/`status` are read by the code under test. */
function attempt({ kind, status }: { kind: CodexAttempt["kind"]; status: CodexAttempt["status"] }): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso: "2026-08-20T00:00:10.000Z",
    items: { kind: "not-measured", reason: "aborted" },
    kind,
    startedAtIso: "2026-08-20T00:00:00.000Z",
    status,
    threadId: status === "answered" ? "thread-1" : null,
    usage: { kind: "not-measured", reason: "aborted" },
  };
}

const PLAN_ANSWER: PlanAnswer = { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" };

/** A minimal, fully-shaped `CodexArtifactRecord` — only `attempts`/`outcome` are read by the code under test. */
function record({
  attempts,
  outcome,
}: {
  attempts: readonly CodexAttempt[];
  outcome: CodexArtifactRecord["outcome"];
}): CodexArtifactRecord {
  return {
    artifactId: "artifact-1",
    attempts,
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-08-20T00:00:00.000Z",
    observedElapsedMs: 10,
    outcome,
    repoRoot: "/w/repo",
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "abc" },
  };
}

const SALVAGE: PassSalvage = {
  commands: 91,
  failedCommands: 3,
  fileChanges: 1,
  lastAgentMessage: "mid-investigation thought",
  recentCommands: ["ls"],
  searches: 2,
};

describe("formatPassOutcomeContext", () => {
  it("adds nothing to a first-try READY", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: PLAN_ANSWER, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBeUndefined();
  });

  it("adds nothing to a first-try CLEAN", () => {
    const cleanAnswer = {
      counterexample: "",
      evidence: "e",
      propertyId: "r1-01",
      summary: "s",
      verdict: "CLEAN" as const,
    };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: cleanAnswer, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBeUndefined();
  });

  it("adds nothing when no attempt data was recorded at all (not evidence of recovery)", () => {
    const result = formatPassOutcomeContext({
      record: record({ attempts: [], outcome: { answer: PLAN_ANSWER, kind: "answered", rawFinalResponse: "{}" } }),
    });
    expect(result).toBeUndefined();
  });

  it("states the recovery chain for a clean answer that only arrived after an aborted initial attempt", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [
          attempt({ kind: "initial", status: "aborted" }),
          attempt({ kind: "conclusion", status: "answered" }),
        ],
        outcome: { answer: PLAN_ANSWER, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("recovered after initial=aborted, conclusion=answered");
  });

  it("reports the blocker count for a first-attempt BLOCKED, without repeat language", () => {
    const blocked: PlanAnswer = { blockers: ["a", "b", "c"], bodyMarkdown: "", summary: "", verdict: "BLOCKED" };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: blocked, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("answer recorded 3 blockers");
  });

  it("uses singular wording for exactly one blocker", () => {
    const blocked: PlanAnswer = { blockers: ["a"], bodyMarkdown: "", summary: "", verdict: "BLOCKED" };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: blocked, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("answer recorded 1 blocker");
  });

  it("scopes a first-attempt BROKEN to the property id, without repeat language", () => {
    const broken = {
      counterexample: "c",
      evidence: "e",
      propertyId: "r1-01",
      summary: "s",
      verdict: "BROKEN" as const,
    };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: broken, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("counterexample and diff evidence recorded for r1-01");
  });

  it("keeps the policy-refusal chain visible on a BROKEN reached only on the retry", () => {
    const broken = {
      counterexample: "c",
      evidence: "e",
      propertyId: "r3-01",
      summary: "s",
      verdict: "BROKEN" as const,
    };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [
          attempt({ kind: "initial", status: "failed" }),
          attempt({ kind: "policy-retry", status: "answered" }),
        ],
        outcome: { answer: broken, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe(
      "counterexample and diff evidence recorded for r3-01 after initial=failed, policy-retry=answered",
    );
  });

  it("states the recovery chain for a CLEAN answered only on the policy retry", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [
          attempt({ kind: "initial", status: "failed" }),
          attempt({ kind: "policy-retry", status: "answered" }),
        ],
        outcome: { answer: PLAN_ANSWER, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("recovered after initial=failed, policy-retry=answered");
  });

  it("names invalid-output plainly, with the attempt chain and salvage", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { kind: "no-verdict", rawFinalResponse: "not json", reason: "invalid-output", salvage: SALVAGE },
      }),
    });
    expect(result).toBe(
      "response failed validation; attempts initial=answered; salvaged 91 commands (3 failed), 2 searches, 1 write, a message was preserved",
    );
  });

  it("names unrecoverable-abort plainly, for an initial attempt with no salvage", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "aborted" })],
        outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "unrecoverable-abort", salvage: null },
      }),
    });
    expect(result).toBe(
      "initial attempt aborted before a thread id was available; attempts initial=aborted; nothing was observed before the stop",
    );
  });

  it("does not crash on a legacy no-verdict record that predates the salvage field entirely", () => {
    // `salvage` is typed required on `CodexPassOutcome`, but `scanPassRecords` only shallow-decodes disk
    // JSON — a real sidecar written before this field existed has it genuinely `undefined` at runtime, not
    // `null`. Found by adversarial review: this used to throw reading `salvage.fileChanges` and would have
    // crashed `codex status` (and `codex status --check`) on encountering exactly this record.
    const legacyOutcome = {
      kind: "no-verdict",
      rawFinalResponse: null,
      reason: "invalid-output",
    } as unknown as CodexArtifactRecord["outcome"];
    const result = formatPassOutcomeContext({
      record: record({ attempts: [attempt({ kind: "initial", status: "answered" })], outcome: legacyOutcome }),
    });
    expect(result).toBe(
      "response failed validation; attempts initial=answered; no salvage recorded (this record predates that field)",
    );
  });

  it("names no-conclusion-in-bound plainly, for a double-aborted attempt chain", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "aborted" }), attempt({ kind: "conclusion", status: "aborted" })],
        outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "no-conclusion-in-bound", salvage: SALVAGE },
      }),
    });
    expect(result).toBe(
      "no valid conclusion before the bound expired; attempts initial=aborted, conclusion=aborted; salvaged 91 commands (3 failed), 2 searches, 1 write, a message was preserved",
    );
  });

  it("names off-track plainly", () => {
    const noMessage: PassSalvage = { ...SALVAGE, lastAgentMessage: null, commands: 1, failedCommands: 0, searches: 0 };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { kind: "no-verdict", rawFinalResponse: "{}", reason: "off-track", salvage: noMessage },
      }),
    });
    expect(result).toBe(
      "tripwire stopped the pass as off-track; attempts initial=answered; salvaged 1 command (0 failed), 0 searches, 1 write, no message preserved",
    );
  });

  it("names a fatal transport failure with its recorded cause and the attempt chain", () => {
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "failed" })],
        outcome: {
          cause: {
            quota: "credits-out",
            reported: "You hit your spend cap set by the owner of your workspace.",
            thrown: "Codex Exec exited with code 1",
          },
          error: { kind: "network", message: "the Codex transport failed", operation: "run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(result).toBe(
      "transport failed: You hit your spend cap set by the owner of your workspace. [quota: credits-out]; attempts initial=failed",
    );
  });

  it("says a legacy fatal record carries no cause, rather than leaving the clause bare", () => {
    const legacy = {
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    } as unknown as CodexArtifactRecord["outcome"];
    const result = formatPassOutcomeContext({
      record: record({ attempts: [attempt({ kind: "initial", status: "failed" })], outcome: legacy }),
    });
    expect(result).toBe(
      "transport failed: cause not recorded (this record predates that field); attempts initial=failed",
    );
  });

  it("never reproduces model-authored prose — blocker text, evidence and the salvaged message stay out of the line", () => {
    const blocked: PlanAnswer = {
      blockers: ["a secret internal reason that must not leak into the terse line\nwith an embedded newline"],
      bodyMarkdown: "",
      summary: "",
      verdict: "BLOCKED",
    };
    const result = formatPassOutcomeContext({
      record: record({
        attempts: [attempt({ kind: "initial", status: "answered" })],
        outcome: { answer: blocked, kind: "answered", rawFinalResponse: "{}" },
      }),
    });
    expect(result).toBe("answer recorded 1 blocker");
    expect(result?.includes("\n")).toBe(false);
  });
});
