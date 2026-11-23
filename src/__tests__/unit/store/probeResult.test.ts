import { describe, expect, it } from "vitest";

import {
  cellLine,
  collapse,
  foldSourceCounts,
  narrowestHit,
  orderCells,
  type ProbeCell,
  type ProbeRow,
} from "../../../store/probe/result.js";
import type { ProbeShape } from "../../../store/probe/shapes.js";

/** One cell, with everything a caller did not name defaulted to the empty case. */
const cell = ({
  shape,
  rows,
  bySource = [],
  ids = null,
  indexed = true,
}: {
  shape: ProbeShape;
  rows: number;
  bySource?: readonly { source: string; rows: number }[];
  ids?: readonly string[] | null;
  indexed?: boolean;
}): ProbeCell => ({ bySource, ids, indexed, rows, shape });

/** One ladder, from the cells a test cares about. */
const row = ({ cells }: { cells: readonly ProbeCell[] }): ProbeRow => ({
  botsHidden: 0,
  cells: orderCells({ cells }),
  elapsedMs: 1,
  kind: "term",
  subject: "barten",
});

describe("foldSourceCounts", () => {
  it("totals every source and drops the empty ones", () => {
    const folded = foldSourceCounts({
      counts: [
        { rows: 17, source: "slack" },
        { rows: 0, source: "gmail" },
        { rows: 19, source: "self" },
      ],
    });
    expect(folded.rows).toBe(36);
    expect(folded.bySource).toEqual([
      { rows: 19, source: "self" },
      { rows: 17, source: "slack" },
    ]);
  });

  it("breaks a tie on the source name, so two runs order the same way", () => {
    const folded = foldSourceCounts({
      counts: [
        { rows: 5, source: "slack" },
        { rows: 5, source: "github" },
      ],
    });
    expect(folded.bySource.map((count) => count.source)).toEqual(["github", "slack"]);
  });

  it("is zero rows and no sources when nothing matched", () => {
    const folded = foldSourceCounts({ counts: [{ rows: 0, source: "slack" }] });
    expect(folded.rows).toBe(0);
    expect(folded.bySource).toEqual([]);
  });
});

describe("orderCells", () => {
  it("puts the narrowest shape first whatever order the cells were computed in", () => {
    const ordered = orderCells({
      cells: [
        cell({ rows: 1, shape: "wild-both" }),
        cell({ rows: 1, shape: "exact" }),
        cell({ rows: 1, shape: "alnum" }),
      ],
    });
    expect(ordered.map((each) => each.shape)).toEqual(["exact", "alnum", "wild-both"]);
  });

  it("ranks every declared shape, so a fully reversed ladder comes back in declared order", () => {
    const declared: readonly ProbeShape[] = [
      "exact",
      "wild-left",
      "slash",
      "alnum",
      "wild-right",
      "wild-both",
      "regex",
    ];
    const ordered = orderCells({ cells: declared.toReversed().map((shape) => cell({ rows: 1, shape })) });
    expect(ordered.map((each) => each.shape)).toEqual(declared);
  });
});

describe("narrowestHit", () => {
  it("skips the empty rungs and returns the first that found rows", () => {
    const found = narrowestHit({
      row: row({ cells: [cell({ rows: 0, shape: "exact" }), cell({ rows: 4, shape: "slash" })] }),
    });
    expect(found?.shape).toBe("slash");
    expect(found?.rows).toBe(4);
  });

  it("is nothing when every shape came back empty", () => {
    expect(narrowestHit({ row: row({ cells: [cell({ rows: 0, shape: "exact" })] }) })).toBe(null);
  });

  it("is nothing for a ladder with no rungs at all", () => {
    expect(narrowestHit({ row: row({ cells: [] }) })).toBe(null);
  });
});

describe("collapse", () => {
  it("names the widest drop between two adjacent non-empty rungs", () => {
    const drop = collapse({
      row: row({
        cells: [
          cell({ rows: 13, shape: "exact" }),
          cell({ rows: 4, shape: "slash" }),
          cell({ rows: 20, shape: "alnum" }),
        ],
      }),
    });
    expect(drop).toEqual({ factor: 5, from: "slash", to: "alnum" });
  });

  it("ignores an empty rung rather than dividing by zero", () => {
    const drop = collapse({
      row: row({
        cells: [
          cell({ rows: 0, shape: "exact" }),
          cell({ rows: 2, shape: "slash" }),
          cell({ rows: 10, shape: "wild-both" }),
        ],
      }),
    });
    expect(drop).toEqual({ factor: 5, from: "slash", to: "wild-both" });
  });

  it("is nothing when only one rung found anything", () => {
    expect(collapse({ row: row({ cells: [cell({ rows: 3, shape: "exact" })] }) })).toBe(null);
  });
});

describe("cellLine", () => {
  it("prints the shape, the owner's own wildcard spelling, the count and the source split", () => {
    const line = cellLine({
      cell: cell({ bySource: [{ rows: 3, source: "slack" }], rows: 3, shape: "slash" }),
    });
    expect(line).toBe("slash      /*term*/                         3  slack 3");
  });

  it("says so when no index could serve the shape", () => {
    const line = cellLine({ cell: cell({ indexed: false, rows: 0, shape: "wild-both" }) });
    expect(line).toBe("wild-both  *term*                           0  [no index — scanned every row]");
  });
});
