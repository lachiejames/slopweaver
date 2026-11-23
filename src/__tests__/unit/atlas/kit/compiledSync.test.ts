import { describe, expect, it } from "vitest";

import {
  assembleKindFile,
  compiledCensusMismatch,
  compiledSyncRechecks,
  countByDisposition,
  groupRowsByKind,
  unfiredRuleIds,
} from "../../../../atlas/kit/compiledSync.js";
import { err, ok } from "../../../../lib/result.js";

const PIN = {
  methodCounts: { delete: 1, get: 3 },
  operationCount: 4,
  pathCount: 2,
  rootCount: 1,
  schemaCount: 5,
} as const;

const CENSUS = {
  methodCounts: { delete: 1, get: 3 },
  operationCount: 4,
  pathCount: 2,
  rootCount: 1,
  schemaCount: 5,
};

describe("compiledCensusMismatch", () => {
  it("accepts a census that matches the pin exactly", () => {
    expect(compiledCensusMismatch({ census: CENSUS, pin: PIN, platform: "x" })).toBe(null);
  });

  it("names each field that moved, and the platform whose document is pinned", () => {
    const problems = compiledCensusMismatch({
      census: { ...CENSUS, pathCount: 9, schemaCount: 4 },
      pin: PIN,
      platform: "microsoft365",
    })!;
    expect(problems[0]).toContain("microsoft365");
    expect(problems).toContain("paths: read 9, pinned 2");
    expect(problems).toContain("schemas: read 4, pinned 5");
  });

  it("catches a method the reader stopped counting, which the total alone would hide", () => {
    const problems = compiledCensusMismatch({
      census: { ...CENSUS, methodCounts: { get: 3 }, operationCount: 4 },
      pin: PIN,
      platform: "x",
    })!;
    expect(problems).toContain("delete operations: read 0, pinned 1");
  });

  it("says the mismatch is a change in the reader rather than in the vendor's document", () => {
    const problems = compiledCensusMismatch({ census: { ...CENSUS, rootCount: 2 }, pin: PIN, platform: "x" })!;
    expect(problems.at(-1)).toContain("a change in THIS reader");
  });
});

describe("groupRowsByKind", () => {
  it("indexes rows by kind, keeping the order they arrived in", () => {
    const rows = [
      { id: "a", kind: "users" },
      { id: "b", kind: "reviews" },
      { id: "c", kind: "users" },
    ];
    const grouped = groupRowsByKind({ kindOf: (row) => row.kind, rows });
    expect(grouped.get("users")!.map((row) => row.id)).toEqual(["a", "c"]);
    expect(grouped.get("reviews")!.map((row) => row.id)).toEqual(["b"]);
  });

  it("has no entry for a kind no row carries", () => {
    expect(groupRowsByKind({ kindOf: (row: { kind: string }) => row.kind, rows: [] }).size).toBe(0);
  });
});

describe("countByDisposition", () => {
  it("keeps a declared member at zero rather than dropping it", () => {
    const counts = countByDisposition({
      dispositionOf: (row: { d: "a" | "b" }) => row.d,
      empty: { a: 0, b: 0 },
      rows: [{ d: "a" }, { d: "a" }],
    });
    expect(counts).toEqual({ a: 2, b: 0 });
  });
});

describe("unfiredRuleIds", () => {
  it("names a reviewed rule no row carries, in declaration order", () => {
    expect(
      unfiredRuleIds({
        declared: ["one", "two", "three"],
        ruleIdOf: (row: { rule: string }) => row.rule,
        rows: [{ rule: "two" }],
      }),
    ).toEqual(["one", "three"]);
  });
});

describe("compiledSyncRechecks", () => {
  it("resolves both conditions a successful compile always rechecks", () => {
    expect(compiledSyncRechecks({ kind: "users" })).toEqual([
      { condition: "spec-census-moved", resolved: true, scope: "users" },
      { condition: "spec-root-undeclared", resolved: true, scope: "users" },
    ]);
  });
});

describe("assembleKindFile", () => {
  const stored = { coverage: ["old"], entities: ["e"], gaps: ["g"], kind: "users", updatedAt: "old" };

  it("replaces exactly four fields and carries every other one forward", () => {
    const built = assembleKindFile({
      at: "2026-09-05T00:00:00.000Z",
      coverage: ["fresh"],
      gaps: ok(["g2"]),
      merged: ok(["e2"]),
      stored,
    });
    expect(built._unsafeUnwrap()).toEqual({
      coverage: ["fresh"],
      entities: ["e2"],
      gaps: ["g2"],
      kind: "users",
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
  });

  it("reports a failed merge and never reaches the gaps", () => {
    const built = assembleKindFile({
      at: "2026-09-05T00:00:00.000Z",
      coverage: ["fresh"],
      gaps: err(["gap trouble"]),
      merged: err(["merge trouble"]),
      stored,
    });
    expect(built._unsafeUnwrapErr()).toEqual(["merge trouble"]);
  });

  it("reports a failed gap reconciliation when the merge succeeded", () => {
    const built = assembleKindFile({
      at: "2026-09-05T00:00:00.000Z",
      coverage: ["fresh"],
      gaps: err(["gap trouble"]),
      merged: ok(["e2"]),
      stored,
    });
    expect(built._unsafeUnwrapErr()).toEqual(["gap trouble"]);
  });
});
