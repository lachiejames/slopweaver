import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../../codex/ledger.js";
import { concluded, newestDriftClause, newestFaultClause } from "../../../codex/ledgerNewestClauses.js";

/** One review row; each case overrides only what it is about. */
const row = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  artifactId: "a1",
  capped: false,
  createdAtIso: "2026-10-02T09:00:00.000Z",
  diffSha256: undefined,
  freshness: { kind: "current" },
  mode: "review",
  outcomeContext: undefined,
  pass: "r3",
  propertyId: "r3-04",
  provider: "claude-code",
  reviewSummary: undefined,
  superseded: undefined,
  verdict: "CLEAN",
  ...over,
});

const DRIFT = "the pass read 331 byte(s) of uncommitted change on top of HEAD 4a922ffd0b1c";

describe("concluded", () => {
  it("counts a verdict and refuses a no-verdict or a fault", () => {
    expect(
      [row(), row({ verdict: "NO_VERDICT:bound" }), row({ verdict: "FATAL:transport" })].map((entry) =>
        concluded({ entry }),
      ),
    ).toEqual([true, false, false]);
  });
});

describe("newestFaultClause", () => {
  it("names the verdict token when the newest pass concluded nothing and carries no context", () => {
    expect(newestFaultClause({ entries: [row({ verdict: "FATAL:transport" })] })).toBe(
      " — the newest, r3, failed outright: FATAL:transport",
    );
  });

  it("names the outcome context when the newest pass carries one", () => {
    expect(newestFaultClause({ entries: [row({ outcomeContext: "spend cap", verdict: "NO_VERDICT:bound" })] })).toBe(
      " — the newest, r3, concluded nothing: spend cap",
    );
  });

  it("says nothing when the newest pass reached a verdict", () => {
    expect(newestFaultClause({ entries: [row(), row({ verdict: "FATAL:transport" })] })).toBe("");
  });
});

describe("newestDriftClause", () => {
  it("names why a concluded newest review is STALE, with its property", () => {
    expect(newestDriftClause({ entries: [row({ freshness: { kind: "stale", reason: DRIFT } })] })).toBe(
      ` — the newest, r3 (r3-04), is STALE: ${DRIFT}`,
    );
  });

  it("says nothing for a current newest review, a no-verdict newest review, or no rows", () => {
    const staleNoVerdict = row({ freshness: { kind: "stale", reason: DRIFT }, verdict: "NO_VERDICT:bound" });
    expect([[row()], [staleNoVerdict], []].map((entries) => newestDriftClause({ entries }))).toEqual(["", "", ""]);
  });
});
