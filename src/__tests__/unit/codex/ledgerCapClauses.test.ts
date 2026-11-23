import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../../codex/ledger.js";
import { cappedNextStep, cappedPlanNextStep } from "../../../codex/ledgerCapClauses.js";
import type { CodexQuotaEvidence } from "../../../codex/quotaTypes.js";

const CAP: CodexQuotaEvidence = { kind: "usage-limit", observedAtIso: "2026-09-14T09:27:23.357Z" };

/** One review row; each case overrides only what it is about. */
const row = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  artifactId: "a1",
  capped: false,
  createdAtIso: "2026-09-14T09:00:00.000Z",
  diffSha256: undefined,
  freshness: { kind: "current" },
  mode: "review",
  outcomeContext: undefined,
  pass: "r1",
  propertyId: "r1-01",
  provider: "codex",
  reviewSummary: undefined,
  superseded: undefined,
  verdict: "CLEAN",
  ...over,
});

describe("cappedNextStep", () => {
  it("says nothing when neither the newest row nor the live gate witnesses a cap", () => {
    expect(cappedNextStep({ cap: undefined, entries: [row()] })).toBe("");
  });

  it("names the review fallback and the live witness when the gate is refusing now", () => {
    expect(cappedNextStep({ cap: CAP, entries: [] })).toBe(
      ". Codex is CAPPED (the quota gate reports usage-limit, observed 2026-09-14T09:27:23.357Z — " +
        "`slopweaver codex quota show`), so a visible Claude session takes this review (rule 9): " +
        "`slopweaver codex review-fallback prepare`, answer the packet, then `codex review-fallback record`",
    );
  });

  it("names the review fallback on a capped newest row alone, with no live witness", () => {
    expect(cappedNextStep({ cap: undefined, entries: [row({ capped: true })] })).toContain(
      ". Codex is CAPPED, so a visible Claude session takes this review",
    );
  });
});

describe("cappedPlanNextStep", () => {
  it("reads a cap-grounded Claude receipt as a witness, and a policy-grounded one as none", () => {
    const capGrounded = row({ fallbackGround: "cap", provider: "claude-code" });
    const policyGrounded = row({ fallbackGround: "cyber-policy", provider: "claude-code" });
    expect(cappedPlanNextStep({ cap: undefined, entries: [capGrounded] })).toContain(
      ". Codex is CAPPED, and nothing waits on it (the owner's ruling)",
    );
    expect(cappedPlanNextStep({ cap: undefined, entries: [policyGrounded] })).toBe("");
  });
});
