import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { refusalReport, rotateReport } from "../../../claude/rotateReport.js";

describe("rotateReport", () => {
  it("says which plan a spawn should be booted against, and that nothing moved", () => {
    // This asserted `outcome: "rotated"`, `active: "plan-one"` and `"moved off plan-three onto plan-one"`, and
    // every part of that became a lie when the credential copy was retired. What the selection pass concluded is still worth saying; what it did is not.
    const report = rotateReport({ decision: { excluded: [], from: "plan-three", kind: "rotate", to: "plan-one" } });
    expect(report.outcome).toBe("recommended");
    expect(report.line).toBe(
      "plan-one is the plan a spawn should be booted against off plan-three — nothing was moved, because the " +
        "credential copy is retired and a session spends a plan by being booted against its store",
    );
  });

  it("carries no `active` FIELD at all, because nothing production reaches establishes one", () => {
    // It named the plan the fleet was on. The only branch that still set it is one no production caller builds —
    // `rotate.ts` constructs `kind: "rotate"` and nothing else — so after the recommendation branch stopped
    // claiming an `active`, the field had no producer a reader could reach. Asserted on
    // the KEYS, because a missing property and a declared-but-absent one read identically through access.
    const report = rotateReport({ decision: { excluded: [], from: "plan-three", kind: "rotate", to: "plan-one" } });
    expect(Object.keys(report).toSorted()).toStrictEqual(["line", "outcome"]);
  });

  it("handles a first-ever selection with no plan to leave", () => {
    const report = rotateReport({ decision: { excluded: [], kind: "rotate", to: "plan-one" } });
    expect(report.line).toBe(
      "plan-one is the plan a spawn should be booted against — nothing was moved, because the credential copy " +
        "is retired and a session spends a plan by being booted against its store",
    );
  });

  it("reports staying put with the reason, and keeps the active plan named", () => {
    // `stay` still names an active plan, and that is not the same claim: it reports where the fleet ALREADY is,
    // which no retirement changed, rather than somewhere a swap put it.
    const report = rotateReport({
      decision: { kind: "stay", on: "plan-two", reason: "the active plan still has plan-wide headroom" },
    });
    expect(report.outcome).toBe("stayed");
    expect(report.line).toBe("staying on plan-two — the active plan still has plan-wide headroom");
  });

  it("carries when the fleet comes back when every plan is spent", () => {
    const report = rotateReport({
      decision: { earliestResetIso: "2026-09-04T04:50:00.000Z", excluded: [], kind: "all-exhausted" },
    });
    expect(report.outcome).toBe("all-exhausted");
    expect(report.line).toBe("every plan is spent, so nothing rotated. the earliest reset is 2026-09-04T04:50:00.000Z");
  });

  it("says so plainly when exhaustion carries no known reset", () => {
    const report = rotateReport({ decision: { excluded: [], kind: "all-exhausted" } });
    expect(report.line).toBe("every plan is spent, so nothing rotated. no reset time is known");
  });
});

describe("refusalReport", () => {
  it("carries the typed message, including the one command that fixes an unsigned store", () => {
    const report = refusalReport({ error: ClaudeRotationErrors.storeNotReady({ alias: "plan-two" }) });
    expect(report.outcome).toBe("refused");
    expect(report.line).toContain("plan-two");
    expect(report.line).toContain("CLAUDE_SECURESTORAGE_CONFIG_DIR");
  });

  it("names the field when the gauge shape changed, so the fix is findable", () => {
    const report = refusalReport({
      error: ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-7d-reset" }),
    });
    expect(report.line).toContain("anthropic-ratelimit-unified-7d-reset");
  });

  it("never carries a credential, because a refusal is printed into logs and events", () => {
    const report = refusalReport({
      error: ClaudeRotationErrors.credentialRejected({ alias: "plan-one", status: 401 }),
    });
    expect(report.line).not.toContain("sk-ant");
    expect(report.line).toContain("plan-one");
  });
});
