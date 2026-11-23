/**
 * Which cards the morning seat reads, and in what order: age may order the list, and only a verified-today stamp
 * takes a card off it. Which rows are candidates at all is `../cli/commands/sweep/recheckRun.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type RecheckRow, recheckBand, recheckCandidates } from "../../../sweep/recheck.js";

const TODAY = "2026-11-09";

/** A card due for a recheck unless `over` says otherwise. */
function row(over: Partial<RecheckRow> & { slug: string }): RecheckRow {
  return {
    priority: "p1",
    question: "Which plan?",
    questionAskedIso: "2026-11-01T00:00:00.000Z",
    stillRealIso: undefined,
    ...over,
  };
}

/** The slugs picked from `rows` at the default test limit. */
function pickedSlugs({ rows, limit = 5 }: { rows: readonly RecheckRow[]; limit?: number }): readonly string[] {
  return recheckCandidates({ limit, rows, todayIso: TODAY }).picked.map((picked) => picked.slug);
}

describe("recheckCandidates", () => {
  it("picks a card never verified", () => {
    expect(pickedSlugs({ rows: [row({ slug: "a" })] })).toEqual(["a"]);
  });

  it("leaves a card verified today", () => {
    expect(pickedSlugs({ rows: [row({ slug: "a", stillRealIso: "2026-11-09T07:20:00.000Z" })] })).toEqual([]);
  });

  it("picks a card last verified yesterday", () => {
    expect(pickedSlugs({ rows: [row({ slug: "a", stillRealIso: "2026-11-08T23:59:59.000Z" })] })).toEqual(["a"]);
  });

  it("orders by priority before anything else", () => {
    const rows = [row({ priority: "p2", slug: "a" }), row({ priority: "p0", slug: "b" })];

    expect(pickedSlugs({ rows })).toEqual(["b", "a"]);
  });

  it("reads an undeclared priority as an ask's default, between p0 and p2", () => {
    const rows = [
      row({ priority: "p2", slug: "a" }),
      row({ priority: undefined, slug: "b" }),
      row({ priority: "p0", slug: "c" }),
    ];

    expect(pickedSlugs({ rows })).toEqual(["c", "b", "a"]);
  });

  it("puts a card never verified ahead of one verified, and older verification ahead of newer", () => {
    const rows = [
      row({ slug: "a", stillRealIso: "2026-11-08T00:00:00.000Z" }),
      row({ slug: "b", stillRealIso: "2026-11-02T00:00:00.000Z" }),
      row({ slug: "c" }),
    ];

    expect(pickedSlugs({ rows })).toEqual(["c", "b", "a"]);
  });

  it("breaks a verification tie on the oldest question, then the slug", () => {
    const rows = [
      row({ questionAskedIso: "2026-11-05T00:00:00.000Z", slug: "a" }),
      row({ slug: "c" }),
      row({ slug: "b" }),
    ];

    expect(pickedSlugs({ rows })).toEqual(["b", "c", "a"]);
  });

  it("stops at the limit and still counts every card due", () => {
    const rows = [row({ slug: "a" }), row({ slug: "b" }), row({ slug: "c" })];
    const { due, picked } = recheckCandidates({ limit: 2, rows, todayIso: TODAY });

    expect(due).toBe(3);
    expect(picked.map((card) => card.slug)).toEqual(["a", "b"]);
  });
});

describe("recheckBand", () => {
  it("reads a declared priority", () => {
    expect(recheckBand({ row: row({ priority: "p3", slug: "a" }) })).toBe("p3");
  });

  it("reads an undeclared priority as p1", () => {
    expect(recheckBand({ row: row({ priority: undefined, slug: "a" }) })).toBe("p1");
  });
});
