import { describe, expect, it } from "vitest";
import { newestPassReport } from "../../../codex/quotaPassEvidence.js";
import type { CodexArtifactRecord, CodexAttempt } from "../../../codex/types.js";

const SPEND_CAP = "You hit your spend cap set by the owner of your workspace.";

const FAILED_ATTEMPT: CodexAttempt = {
  elapsedMs: 10,
  finishedAtIso: "2026-09-12T07:00:10.000Z",
  items: { kind: "not-measured", reason: "transport-failed" },
  kind: "initial",
  startedAtIso: "2026-09-12T07:00:00.000Z",
  status: "failed",
  threadId: null,
  usage: { kind: "not-measured", reason: "transport-failed" },
};

const CAPPED: CodexArtifactRecord["outcome"] = {
  cause: { quota: "credits-out", reported: SPEND_CAP, thrown: "Codex Exec exited with code 1" },
  error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
  kind: "fatal",
  salvage: null,
};

/** A minimal, fully-shaped record — only id, instant, pass, attempts and outcome are read. */
function passRecord({
  artifactId,
  createdAtIso,
  outcome,
  attempts = [FAILED_ATTEMPT],
}: {
  artifactId: string;
  createdAtIso: string;
  outcome: CodexArtifactRecord["outcome"];
  attempts?: readonly CodexAttempt[];
}): CodexArtifactRecord {
  return {
    artifactId,
    attempts,
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso,
    observedElapsedMs: 10,
    outcome,
    repoRoot: "/w/repo",
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "abc" },
  };
}

describe("newestPassReport", () => {
  it("reports the newest pass's spend cap, whatever order the scan yielded", () => {
    const records = [
      passRecord({ artifactId: "a", createdAtIso: "2026-09-12T06:00:00.000Z", outcome: CAPPED }),
      passRecord({ artifactId: "c", createdAtIso: "2026-09-12T07:26:50.239Z", outcome: CAPPED }),
      passRecord({ artifactId: "b", createdAtIso: "2026-09-12T07:00:00.000Z", outcome: CAPPED }),
    ];
    expect(newestPassReport({ records })).toEqual({
      artifactId: "c",
      cause: `${SPEND_CAP} [quota: credits-out]`,
      createdAtIso: "2026-09-12T07:26:50.239Z",
      outcome: "fatal",
      pass: "p1",
      quota: "credits-out",
    });
  });

  it("reports a newer ANSWERED pass as the newest, with no quota and no cause", () => {
    const answered = passRecord({
      artifactId: "later",
      createdAtIso: "2026-09-12T08:00:00.000Z",
      outcome: {
        answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
    });
    const records = [
      passRecord({ artifactId: "earlier", createdAtIso: "2026-09-12T07:00:00.000Z", outcome: CAPPED }),
      answered,
    ];
    expect(newestPassReport({ records })).toEqual({
      artifactId: "later",
      cause: null,
      createdAtIso: "2026-09-12T08:00:00.000Z",
      outcome: "answered",
      pass: "p1",
      quota: null,
    });
  });

  it("skips a record with no attempts — a scratch workspace that never reached the transport", () => {
    const scratchFailure = passRecord({
      artifactId: "scratch",
      attempts: [],
      createdAtIso: "2026-09-12T09:00:00.000Z",
      outcome: { ...CAPPED, cause: { quota: null, reported: null, thrown: "EACCES" } },
    });
    const records = [
      scratchFailure,
      passRecord({ artifactId: "capped", createdAtIso: "2026-09-12T07:00:00.000Z", outcome: CAPPED }),
    ];
    expect(newestPassReport({ records })?.artifactId).toBe("capped");
  });

  it("breaks a tie on the creation instant by artifact id, so the answer is deterministic", () => {
    const at = "2026-09-12T07:00:00.000Z";
    const records = [
      passRecord({ artifactId: "aaa", createdAtIso: at, outcome: CAPPED }),
      passRecord({ artifactId: "zzz", createdAtIso: at, outcome: CAPPED }),
    ];
    expect(newestPassReport({ records })?.artifactId).toBe("zzz");
    expect(newestPassReport({ records: records.toReversed() })?.artifactId).toBe("zzz");
  });

  it("reports a legacy fatal with no recorded cause as such, and claims no quota for it", () => {
    const legacy = {
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    } as unknown as CodexArtifactRecord["outcome"];
    const report = newestPassReport({
      records: [passRecord({ artifactId: "old", createdAtIso: "2026-09-12T07:00:00.000Z", outcome: legacy })],
    });
    expect(report?.cause).toBe("cause not recorded (this record predates that field)");
    expect(report?.quota).toBe(null);
  });

  it("is undefined when no record made a transport attempt", () => {
    expect(newestPassReport({ records: [] })).toBe(undefined);
  });
});
