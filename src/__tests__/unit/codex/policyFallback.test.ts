import { describe, expect, it } from "vitest";
import { CodexErrors } from "../../../codex/errors.js";

import type { ClaudeFallbackReviewReceipt } from "../../../codex/fallbackReview.js";
import { parsePolicyRefusalEvidence } from "../../../codex/fallbackReviewParse.js";
import {
  POLICY_REFUSAL_REVIEW_MODE,
  type PolicyFallbackSubject,
  validatePolicyFallback,
} from "../../../codex/policyFallback.js";
import { renderPolicyRefusalLines, summarizePolicyRefusals } from "../../../codex/policyRefusalSummary.js";
import type {
  CodexArtifactRecord,
  CodexAttempt,
  CodexPassScope,
  CodexPassTree,
  ReviewProperty,
} from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";

/** OpenAI's own words, verbatim from a refused pass's rollout. */
const REFUSAL =
  "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. " +
  "To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber";

const REFUSED_CAUSE = { quota: null, reported: null, thrown: REFUSAL };
const NETWORK_CAUSE = { quota: null, reported: null, thrown: "stream disconnected before completion" };

const TREE: CodexPassTree = { branch: "feature", dirtyBytes: 0, fingerprint: "fp-1", headSha: "a".repeat(40) };

const SUBJECT: PolicyFallbackSubject = {
  diffBytes: 120,
  diffSha256: "d".repeat(64),
  pass: "r3",
  property: { id: "r3-01", statement: "no refusal grounds a different review" },
  repoRoot: "/w/repo",
  tree: TREE,
};

function attempt({
  kind,
  status,
  cause,
  finishedAtIso,
}: {
  kind: CodexAttempt["kind"];
  status: CodexAttempt["status"];
  cause?: CodexAttempt["cause"];
  finishedAtIso: string;
}): CodexAttempt {
  return {
    elapsedMs: 10,
    finishedAtIso,
    items: { kind: "not-measured", reason: "aborted" },
    kind,
    startedAtIso: "2026-09-23T06:00:00.000Z",
    status,
    threadId: "t",
    usage: { kind: "not-measured", reason: "aborted" },
    ...(cause === undefined ? {} : { cause }),
  };
}

const INITIAL_REFUSED = attempt({
  cause: REFUSED_CAUSE,
  finishedAtIso: "2026-09-23T06:01:00.000Z",
  kind: "initial",
  status: "failed",
});
const RETRY_REFUSED = attempt({
  cause: REFUSED_CAUSE,
  finishedAtIso: "2026-09-23T06:03:00.000Z",
  kind: "policy-retry",
  status: "failed",
});

/** A review pass record over {@link SUBJECT}, refused twice unless the caller says otherwise. */
function refusedRecord(over: Partial<CodexArtifactRecord> = {}): CodexArtifactRecord {
  return {
    artifactId: "codex-r3-refused",
    attempts: [INITIAL_REFUSED, RETRY_REFUSED],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-09-23T06:00:00.000Z",
    observedElapsedMs: 10,
    outcome: {
      cause: REFUSED_CAUSE,
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    },
    repoRoot: SUBJECT.repoRoot,
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: {
      baseRef: "origin/main",
      baseSha: "b".repeat(40),
      diffBytes: SUBJECT.diffBytes,
      diffSha256: SUBJECT.diffSha256,
      headSha: TREE.headSha,
      mode: "review",
      pass: SUBJECT.pass,
      property: SUBJECT.property,
    },
    tree: TREE,
    ...over,
  };
}

function validate({ record }: { record: CodexArtifactRecord }): ReturnType<typeof validatePolicyFallback> {
  return validatePolicyFallback({ artifactId: "codex-r3-refused", record, subject: SUBJECT });
}

describe("validatePolicyFallback", () => {
  it("grounds a fallback on a review refused on its initial attempt AND its one retry", () => {
    expect(unwrap(validate({ record: refusedRecord() }))).toEqual({
      artifactId: "codex-r3-refused",
      initialFinishedAtIso: "2026-09-23T06:01:00.000Z",
      kind: "cyber-policy",
      retryFinishedAtIso: "2026-09-23T06:03:00.000Z",
    });
  });

  it("refuses a historical refusal with no retry behind it — none of those authorises a fallback", () => {
    const legacy = refusedRecord({ attempts: [attempt({ ...INITIAL_REFUSED, cause: REFUSED_CAUSE })] });
    const error = validate({ record: legacy })._unsafeUnwrapErr();
    expect(error.code).toBe("RETRY_NOT_EXHAUSTED");
    expect(error.message).toContain("(attempts initial)");
  });

  it("refuses a legacy record whose initial attempt carries no cause of its own", () => {
    const { cause: _cause, ...noCause } = INITIAL_REFUSED;
    const error = validate({ record: refusedRecord({ attempts: [noCause, RETRY_REFUSED] }) })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toBe(
      "pass codex-r3-refused is not a review refused on policy: its initial attempt carries no recorded cyber-policy cause",
    );
  });

  it("refuses a refused attempt with no finishedAtIso, rather than write a request its own reader refuses", () => {
    const { finishedAtIso: _finishedAtIso, ...noInstant } = INITIAL_REFUSED;
    const error = validate({
      record: refusedRecord({ attempts: [noInstant as CodexAttempt, RETRY_REFUSED] }),
    })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain("attempt 0 records no finishedAtIso");
  });

  it("refuses a record of a schema this build does not read", () => {
    const future: unknown = 999;
    const error = validate({ record: refusedRecord({ schemaVersion: future as 1 }) })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain("its schemaVersion is 999, not the 1 this build reads");
  });

  it("refuses an attempt whose usage is neither measured nor not-measured", () => {
    const error = validate({
      record: refusedRecord({ attempts: [{ ...INITIAL_REFUSED, usage: {} as CodexAttempt["usage"] }, RETRY_REFUSED] }),
    })._unsafeUnwrapErr();
    expect(error.message).toContain("attempt 0 records no usage");
  });

  it.each([["startedAtIso"], ["threadId"], ["usage"]] as const)(
    "refuses a refused attempt that records no %s",
    (field) => {
      const { [field]: _dropped, ...partial } = INITIAL_REFUSED;
      const error = validate({
        record: refusedRecord({ attempts: [partial as CodexAttempt, RETRY_REFUSED] }),
      })._unsafeUnwrapErr();
      expect(error.code).toBe("INVALID_REFUSAL_RECORD");
      expect(error.message).toContain(`attempt 0 records no ${field}`);
    },
  );

  it("refuses a review record whose scope names no property, rather than crash on it", () => {
    const record = refusedRecord();
    const scope = record.scope as Extract<CodexPassScope, { mode: "review" }>;
    const missing: unknown = null;
    const error = validate({
      record: { ...record, scope: { ...scope, property: missing as ReviewProperty } },
    })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain("its scope names no property");
  });

  it("names a hand-edited outcome kind that is no string, rather than crash formatting it", () => {
    const crafted: unknown = { toString: null };
    const record = refusedRecord();
    const error = validate({
      record: {
        ...record,
        outcome: { ...record.outcome, kind: crafted as "answered" } as CodexArtifactRecord["outcome"],
      },
    })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain('its outcome is {"toString":null}, not a fatal cyber-policy refusal');
  });
  it("refuses a pass the retry rescued", () => {
    const rescued = refusedRecord({
      outcome: {
        answer: { counterexample: "", evidence: "e", propertyId: "r3-01", summary: "s", verdict: "CLEAN" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
    });
    const error = validate({ record: rescued })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain('its outcome is "answered", not a fatal cyber-policy refusal');
  });

  it("refuses a retry that failed on another cause — a network drop is not this ground", () => {
    const retryDropped = attempt({ ...RETRY_REFUSED, cause: NETWORK_CAUSE });
    const error = validate({ record: refusedRecord({ attempts: [INITIAL_REFUSED, retryDropped] }) })._unsafeUnwrapErr();
    expect(error.code).toBe("RETRY_NOT_EXHAUSTED");
    expect(error.message).toContain("the retry ended failed on another cause");
  });

  it("refuses a fatal on another fault entirely", () => {
    const capped = refusedRecord({
      outcome: {
        cause: { quota: "credits-out", reported: "You hit your spend cap", thrown: "exited 1" },
        error: { kind: "llm", message: "spend cap", operation: "codex.run" },
        kind: "fatal",
        salvage: null,
      },
    });
    expect(validate({ record: capped })._unsafeUnwrapErr().code).toBe("INVALID_REFUSAL_RECORD");
  });

  it("refuses a plan pass", () => {
    const plan = refusedRecord({ scope: { mode: "plan", pass: "p1", promptBytes: 1, promptSha256: "p" } });
    expect(validate({ record: plan })._unsafeUnwrapErr().message).toBe(
      "pass codex-r3-refused is not a review refused on policy: it is a plan pass",
    );
  });

  it("refuses a record filed under a different id than the one asked for", () => {
    const error = validate({ record: refusedRecord({ artifactId: "other" }) })._unsafeUnwrapErr();
    expect(error.code).toBe("INVALID_REFUSAL_RECORD");
    expect(error.message).toContain("its record names other");
  });

  it.each([
    ["repoRoot", { repoRoot: "/w/other" }],
    ["property statement", { property: { id: "r3-01", statement: "a softer claim" } }],
    ["property id", { property: { id: "r3-02", statement: SUBJECT.property.statement } }],
    ["pass", { pass: "r2" as const }],
    ["diffSha256", { diffSha256: "e".repeat(64) }],
    ["diffBytes", { diffBytes: 121 }],
    ["tree branch", { tree: { ...TREE, branch: "elsewhere" } }],
    ["tree headSha", { tree: { ...TREE, headSha: "c".repeat(40) } }],
    ["tree fingerprint", { tree: { ...TREE, fingerprint: "fp-2" } }],
  ] as const)("refuses a refusal over a different %s — it grounds only the review it refused", (field, over) => {
    const error = validatePolicyFallback({
      artifactId: "codex-r3-refused",
      record: refusedRecord(),
      subject: { ...SUBJECT, ...over },
    })._unsafeUnwrapErr();
    expect(error).toMatchObject({ code: "REFUSAL_SCOPE_MISMATCH", field });
  });

  it("never reads a detached HEAD as a branch named null", () => {
    const error = validatePolicyFallback({
      artifactId: "codex-r3-refused",
      record: refusedRecord({ tree: { ...TREE, branch: null } }),
      subject: { ...SUBJECT, tree: { ...TREE, branch: "null" } },
    })._unsafeUnwrapErr();
    expect(error).toMatchObject({ code: "REFUSAL_SCOPE_MISMATCH", field: "tree branch" });
    expect(error.message).toContain('its tree branch is null and this one\'s is "null"');
  });

  it("never reads a hand-edited diffBytes [120] as the number 120", () => {
    // The store's decode is shallow, so a record's scope can carry any JSON where a number belongs.
    const handEdited: unknown = [SUBJECT.diffBytes];
    const record = refusedRecord();
    const scope = record.scope as Extract<CodexPassScope, { mode: "review" }>;
    const error = validatePolicyFallback({
      artifactId: "codex-r3-refused",
      record: { ...record, scope: { ...scope, diffBytes: handEdited as number } },
      subject: SUBJECT,
    })._unsafeUnwrapErr();
    expect(error).toMatchObject({ code: "REFUSAL_SCOPE_MISMATCH", field: "diffBytes" });
    expect(error.message).toContain("its diffBytes is [120] and this one's is 120");
  });
});

describe("parsePolicyRefusalEvidence", () => {
  it("reads back what validatePolicyFallback wrote", () => {
    const evidence = unwrap(validate({ record: refusedRecord() }));
    expect(unwrap(parsePolicyRefusalEvidence({ value: JSON.parse(JSON.stringify(evidence)) }))).toEqual(evidence);
  });

  it("refuses another kind", () => {
    const evidence = unwrap(validate({ record: refusedRecord() }));
    const refused = parsePolicyRefusalEvidence({ value: { ...evidence, kind: "cap" } })._unsafeUnwrapErr();
    expect(refused).toEqual(CodexErrors.groundIncomplete());
    expect(refused.message).toBe(
      "ground must carry kind cyber-policy, artifactId, initialFinishedAtIso and retryFinishedAtIso",
    );
  });
});

/** A bound receipt on the refusal ground for `artifactId`, as the store would hand it over. */
function refusalReceipt({ artifactId }: { artifactId: string }): ClaudeFallbackReviewReceipt {
  return {
    answer: { counterexample: "", evidence: "e", propertyId: "r3-01", summary: "s", verdict: "CLEAN" },
    completedAtIso: "2026-09-23T07:00:00.000Z",
    receiptId: "rcpt-1",
    request: {
      baseRef: "origin/main",
      baseSha: "b".repeat(40),
      createdAtIso: "2026-09-23T06:30:00.000Z",
      diffBytes: SUBJECT.diffBytes,
      diffSha256: SUBJECT.diffSha256,
      ground: {
        artifactId,
        initialFinishedAtIso: "2026-09-23T06:01:00.000Z",
        kind: "cyber-policy",
        retryFinishedAtIso: "2026-09-23T06:03:00.000Z",
      },
      headSha: TREE.headSha,
      mode: POLICY_REFUSAL_REVIEW_MODE,
      pass: "r3",
      property: SUBJECT.property,
      repoRoot: SUBJECT.repoRoot,
      requestId: "req-1",
      schemaVersion: 1,
      tree: TREE,
    },
    requestId: "req-1",
    requestSha256: "f".repeat(64),
    reviewer: { host: "claude-code", model: "opus", workspace: null },
    schemaVersion: 1,
  };
}

const NOW = "2026-09-23T12:00:00.000Z";

describe("summarizePolicyRefusals", () => {
  const rescued = refusedRecord({
    artifactId: "rescued",
    attempts: [
      INITIAL_REFUSED,
      attempt({ finishedAtIso: "2026-09-23T06:02:00.000Z", kind: "policy-retry", status: "answered" }),
    ],
    outcome: {
      answer: { counterexample: "", evidence: "e", propertyId: "r3-01", summary: "s", verdict: "CLEAN" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
  });
  const legacy = refusedRecord({
    artifactId: "legacy",
    attempts: [attempt({ finishedAtIso: "2026-09-22T06:01:00.000Z", kind: "initial", status: "failed" })],
    createdAtIso: "2026-09-22T06:00:00.000Z",
  });
  const tooOld = refusedRecord({ artifactId: "too-old", createdAtIso: "2026-09-12T06:00:00.000Z" });
  const clean = refusedRecord({
    artifactId: "clean",
    attempts: [attempt({ finishedAtIso: "2026-09-23T06:01:00.000Z", kind: "initial", status: "answered" })],
    outcome: rescued.outcome,
  });
  const elsewhere = refusedRecord({ artifactId: "elsewhere", tree: { ...TREE, branch: "other" } });

  it("counts attempts, passes, rescues and twice-refusals over the week, and names this branch's open ones", () => {
    const summary = summarizePolicyRefusals({
      branch: "feature",
      nowIso: NOW,
      receipts: [],
      records: [refusedRecord(), rescued, legacy, tooOld, clean, elsewhere],
      repoRoot: SUBJECT.repoRoot,
    });
    expect(summary).toEqual({
      affectedPasses: 4,
      completedFallbacks: 0,
      refusedAttempts: 6,
      rescuedPasses: 1,
      twiceRefusedHere: ["codex-r3-refused"],
      twiceRefusedPasses: 2,
    });
  });

  it("stops naming a twice-refused pass once a Claude fallback answered it, and counts that fallback", () => {
    const summary = summarizePolicyRefusals({
      branch: "feature",
      nowIso: NOW,
      receipts: [refusalReceipt({ artifactId: "codex-r3-refused" })],
      records: [refusedRecord()],
      repoRoot: SUBJECT.repoRoot,
    });
    expect(summary.twiceRefusedHere).toEqual([]);
    expect(summary.completedFallbacks).toBe(1);
  });

  it("renders nothing when the week holds no refusal", () => {
    const summary = summarizePolicyRefusals({
      branch: "feature",
      nowIso: NOW,
      receipts: [],
      records: [clean],
      repoRoot: SUBJECT.repoRoot,
    });
    expect(renderPolicyRefusalLines({ summary })).toEqual([]);
  });

  it("renders the class line, then the way through for each open twice-refused pass on this branch", () => {
    const summary = summarizePolicyRefusals({
      branch: "feature",
      nowIso: NOW,
      receipts: [],
      records: [refusedRecord(), rescued],
      repoRoot: SUBJECT.repoRoot,
    });
    expect(renderPolicyRefusalLines({ summary })).toEqual([
      "REFUSED: 2 pass(es) hit OpenAI's cyber-policy refusal in the last 7 days (3 refused attempt(s)): 1 answered " +
        "on the one retry, 1 refused twice, 0 Claude fallback review(s) taken on that ground",
      "REFUSED: pass codex-r3-refused on this branch was refused twice — a visible Claude session takes it: " +
        "slopweaver codex review-fallback prepare --after-refusal codex-r3-refused …",
    ]);
  });
});
