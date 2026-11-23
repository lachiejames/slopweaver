import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../../codex/ledger.js";
import { renderLedger } from "../../../codex/ledgerRender.js";
import { CHASE_DISPLAY_STREAK, chaseLines, propertyChases } from "../../../codex/propertyChase.js";

/** One ledger row; overrides set exactly the field a case is about. */
function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    artifactId: "a-1",
    capped: false,
    createdAtIso: "2026-09-24T12:00:00.000Z",
    diffSha256: undefined,
    freshness: { kind: "stale", reason: "the tree moved" },
    mode: "review",
    outcomeContext: undefined,
    pass: "r1",
    propertyId: "r1-docs",
    provider: "codex",
    reviewSummary: undefined,
    superseded: undefined,
    verdict: "BROKEN",
    ...over,
  };
}

/** `count` runs of one property, the newest first, every one carrying `verdict`. */
function runs({
  count,
  verdict,
  propertyId = "r1-docs",
  startMinute = 50,
}: {
  count: number;
  verdict: string;
  propertyId?: string;
  startMinute?: number;
}): LedgerEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({
      artifactId: `${propertyId}-${String(startMinute - index)}`,
      createdAtIso: `2026-09-24T12:${String(startMinute - index).padStart(2, "0")}:00.000Z`,
      propertyId,
      verdict,
    }),
  );
}

describe("propertyChases", () => {
  it("reports a property whose newest runs are all BROKEN, with the streak and the run count", () => {
    const entries = [
      ...runs({ count: 3, verdict: "BROKEN" }),
      ...runs({ count: 1, startMinute: 10, verdict: "CLEAN" }),
    ];
    expect(propertyChases({ entries })).toEqual([{ brokenStreak: 3, pass: "r1", propertyId: "r1-docs", runs: 4 }]);
  });

  it("counts the streak back from the newest run even when the rows arrive oldest first", () => {
    const entries = runs({ count: 4, verdict: "BROKEN" }).toReversed();
    expect(propertyChases({ entries })[0]!.brokenStreak).toBe(4);
  });

  it("stops the streak at a CLEAN verdict", () => {
    const entries = [
      ...runs({ count: 2, verdict: "BROKEN" }),
      ...runs({ count: 1, startMinute: 40, verdict: "CLEAN" }),
      ...runs({ count: 5, startMinute: 30, verdict: "BROKEN" }),
    ];
    expect(propertyChases({ entries })).toEqual([]);
  });

  it("skips a fatal or NO_VERDICT run rather than letting it break the streak", () => {
    const entries = [
      ...runs({ count: 2, verdict: "BROKEN" }),
      entry({ artifactId: "fault", createdAtIso: "2026-09-24T12:45:00.000Z", verdict: "FATAL" }),
      entry({ artifactId: "silent", createdAtIso: "2026-09-24T12:44:00.000Z", verdict: "NO_VERDICT:timeout" }),
      ...runs({ count: 1, startMinute: 40, verdict: "BROKEN" }),
    ];
    expect(propertyChases({ entries })).toEqual([{ brokenStreak: 3, pass: "r1", propertyId: "r1-docs", runs: 3 }]);
  });

  it("leaves out a superseded run, whose wording is no longer the question", () => {
    const retired = {
      artifactId: "r1-docs-50",
      atIso: "2026-09-24T13:00:00.000Z",
      propertyId: "r1-docs",
      reason: "unbounded",
      replacedBy: "x",
    };
    const entries = runs({ count: 3, verdict: "BROKEN" }).map((row, index) =>
      index === 0 ? { ...row, superseded: retired } : row,
    );
    expect(propertyChases({ entries })).toEqual([]);
  });

  it("ignores plan rows and review rows that name no property", () => {
    const entries = [
      ...runs({ count: 3, verdict: "BROKEN" }).map((row) => ({ ...row, mode: "plan" as const, pass: "p2" as const })),
      ...runs({ count: 3, verdict: "BROKEN" }).map((row) => ({ ...row, propertyId: undefined })),
    ];
    expect(propertyChases({ entries })).toEqual([]);
  });

  it("prints nothing below the display streak", () => {
    const entries = runs({ count: CHASE_DISPLAY_STREAK - 1, verdict: "BROKEN" });
    expect(propertyChases({ entries })).toEqual([]);
  });

  it("orders chases by streak, longest first, then by property id", () => {
    const entries = [
      ...runs({ count: 3, propertyId: "r3-b", verdict: "BROKEN" }),
      ...runs({ count: 3, propertyId: "r3-a", verdict: "BROKEN" }),
      ...runs({ count: 6, propertyId: "r2-z", verdict: "BROKEN" }),
    ];
    expect(propertyChases({ entries }).map((chase) => chase.propertyId)).toEqual(["r2-z", "r3-a", "r3-b"]);
  });

  it("lets a Claude fallback receipt end a chase exactly as a Codex verdict would", () => {
    const entries = [
      entry({
        artifactId: "fallback",
        createdAtIso: "2026-09-24T13:00:00.000Z",
        provider: "claude-code",
        verdict: "CLEAN",
      }),
      ...runs({ count: 3, verdict: "BROKEN" }),
    ];
    expect(propertyChases({ entries })).toEqual([]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(propertyChases({ entries: [] })).toEqual([]);
  });
});

describe("chaseLines", () => {
  it("prints one line per chase and one line saying what to weigh", () => {
    expect(chaseLines({ chases: [{ brokenStreak: 7, pass: "r1", propertyId: "r1-docs", runs: 9 }] })).toEqual([
      "CHASE: r1-docs (r1) came back BROKEN on its last 7 of 9 run(s) on this branch — each fix met a new counterexample",
      "  before buying another run, judge the newest finding: take it, narrow the property, or retire the wording " +
        "(codex supersede) — skills/codex/reference/when-a-pass-earns-its-cost.md § A property chase",
    ]);
  });

  it("prints nothing when there is no chase", () => {
    expect(chaseLines({ chases: [] })).toEqual([]);
  });
});

describe("renderLedger", () => {
  it("closes the status report with the chase lines", () => {
    const lines = renderLedger({
      branch: "b",
      entries: runs({ count: 3, verdict: "BROKEN" }),
      headSha: undefined,
      unattributed: 0,
      unplaceable: [],
      unreadable: 0,
      withoutSidecar: 0,
    });
    expect(lines.at(-2)).toBe(
      "CHASE: r1-docs (r1) came back BROKEN on its last 3 of 3 run(s) on this branch — each fix met a new counterexample",
    );
  });
});
