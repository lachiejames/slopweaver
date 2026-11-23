/** The answer arm's per-block size bounds and its citation hygiene, read off a real Zod refinement context. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Citation, DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import { checkBodyBlock, checkCitations } from "../../../../outbound/assistant/answerBodyChecks.js";

/** One reported issue, reduced to the two fields a caller reads. */
interface Issue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

/** Every issue one refinement body raised, in order; an empty list when it raised none. */
function issuesOf({ refine }: { refine: (ctx: z.RefinementCtx) => void }): Issue[] {
  const parsed = z
    .unknown()
    .superRefine((_value, ctx) => {
      refine(ctx);
    })
    .safeParse(null);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path }));
}

/** One plain text run sequence of `length` characters. */
function text({ length }: { length: number }): InlineRun[] {
  return [{ text: "a".repeat(length), type: "text" }];
}

/** A `[n]` chip pointing at citation `id`. */
function chip({ id }: { id: string }): InlineRun {
  return { citationId: id, type: "citation" };
}

/** A citation definition for `id`. */
function citation({ id }: { id: string }): Citation {
  return { id, label: `[${id}]`, url: `https://example.com/${id}` };
}

/** The ids `c0` … `c<count-1>`. */
function ids({ count }: { count: number }): string[] {
  return Array.from({ length: count }, (_unused, n) => `c${String(n)}`);
}

/** Every issue `checkBodyBlock` raises for one block at body index 1. */
function blockIssues({ block, citations = [] }: { block: DetailBlock; citations?: readonly Citation[] }): Issue[] {
  return issuesOf({
    refine: (ctx) => {
      checkBodyBlock({ block, citations, ctx, index: 1 });
    },
  });
}

/** Every issue `checkCitations` raises for one answer. */
function citationIssues({
  body,
  citations,
  index = [],
}: {
  body: readonly DetailBlock[];
  citations: readonly Citation[];
  index?: readonly (readonly InlineRun[])[];
}): Issue[] {
  return issuesOf({
    refine: (ctx) => {
      checkCitations({ body, citations, ctx, index });
    },
  });
}

/** The budget refusal for `count` citations against an earned `ceiling`. */
function budgetMessage({ ceiling, count }: { ceiling: number; count: number }): string {
  return (
    `${String(count)} citations, over the ${String(ceiling)} this answer earns — the budget is the larger of 12 ` +
    "(CITATIONS_MAX) and the answer's own paragraph/bullet/table-row/index-line count, so one more cited ROW buys " +
    "one more citation. Add the rows the citations ground, or drop the citations."
  );
}

describe("checkBodyBlock", () => {
  it("accepts a paragraph of 650 visible chars and refuses one of 651", () => {
    expect(blockIssues({ block: { runs: text({ length: 650 }), type: "paragraph" } })).toEqual([]);
    expect(blockIssues({ block: { runs: text({ length: 651 }), type: "paragraph" } })).toEqual([
      { message: "paragraph is 651 visible chars, over the 650 cap", path: ["body", 1] },
    ]);
  });

  it("counts a citation chip at its own rendered label's width", () => {
    const runs: InlineRun[] = [...text({ length: 647 }), chip({ id: "c1" })];
    expect(
      blockIssues({
        block: { runs, type: "paragraph" },
        citations: [{ id: "c1", label: "[1]", url: "https://example.com" }],
      }),
    ).toEqual([]);
    expect(
      blockIssues({
        block: { runs, type: "paragraph" },
        citations: [{ id: "c1", label: "[c1]", url: "https://example.com" }],
      }),
    ).toEqual([{ message: "paragraph is 651 visible chars, over the 650 cap", path: ["body", 1] }]);
  });

  it("accepts a bullet of 200 and refuses one of 201, naming the bullet's own index", () => {
    expect(blockIssues({ block: { items: [text({ length: 200 }), text({ length: 201 })], type: "bullets" } })).toEqual([
      { message: "bullet is 201 visible chars, over the 200 cap", path: ["body", 1, "items", 1] },
    ]);
  });

  it("labels a bulletless list's over-wide entry as a list item", () => {
    expect(blockIssues({ block: { items: [text({ length: 201 }), text({ length: 200 })], type: "list" } })).toEqual([
      { message: "list item is 201 visible chars, over the 200 cap", path: ["body", 1, "items", 0] },
    ]);
  });

  it("accepts a table row as wide as its header and refuses one a cell short", () => {
    const block: DetailBlock = {
      columns: ["a", "b"],
      rows: [[text({ length: 1 }), text({ length: 1 })], [text({ length: 1 })]],
      type: "table",
    };
    expect(blockIssues({ block })).toEqual([
      { message: "table row 1 has 1 cells but there are 2 columns", path: ["body", 1, "rows", 1] },
    ]);
  });

  it("accepts a table cell of 120 visible chars and refuses one of 121", () => {
    const block: DetailBlock = {
      columns: ["a", "b"],
      rows: [[text({ length: 120 }), text({ length: 121 })]],
      type: "table",
    };
    expect(blockIssues({ block })).toEqual([
      { message: "table cell is 121 visible chars, over the 120 cap", path: ["body", 1, "rows", 0, 1] },
    ]);
  });
});

describe("checkCitations", () => {
  it("accepts 12 citations on a one-item answer and refuses 13", () => {
    const twelve = ids({ count: 12 });
    const thirteen = ids({ count: 13 });
    expect(
      citationIssues({
        body: [{ runs: twelve.map((id) => chip({ id })), type: "paragraph" }],
        citations: twelve.map((id) => citation({ id })),
      }),
    ).toEqual([]);
    expect(
      citationIssues({
        body: [{ runs: thirteen.map((id) => chip({ id })), type: "paragraph" }],
        citations: thirteen.map((id) => citation({ id })),
      }),
    ).toEqual([{ message: budgetMessage({ ceiling: 12, count: 13 }), path: ["citations"] }]);
  });

  it("accepts 13 citations when 13 index lines earn that ceiling, and refuses a 14th", () => {
    const thirteen = ids({ count: 13 });
    const fourteen = ids({ count: 14 });
    expect(
      citationIssues({
        body: [],
        citations: thirteen.map((id) => citation({ id })),
        index: thirteen.map((id) => [chip({ id })]),
      }),
    ).toEqual([]);
    expect(
      citationIssues({
        body: [],
        citations: fourteen.map((id) => citation({ id })),
        index: thirteen.map((id) => [chip({ id })]),
      }),
    ).toEqual([
      { message: budgetMessage({ ceiling: 13, count: 14 }), path: ["citations"] },
      { message: 'citation "c13" is defined but no run in body or index cites it', path: ["citations", 13] },
    ]);
  });

  it("refuses a duplicated citation id", () => {
    expect(
      citationIssues({
        body: [{ runs: [chip({ id: "a" })], type: "paragraph" }],
        citations: [citation({ id: "a" }), citation({ id: "a" })],
      }),
    ).toEqual([{ message: "citation ids must be unique", path: ["citations"] }]);
  });

  it("refuses a body chip naming an unknown citation, at its position in the flattened body walk", () => {
    expect(
      citationIssues({
        body: [
          { runs: text({ length: 1 }), type: "paragraph" },
          { runs: [...text({ length: 1 }), chip({ id: "z" })], type: "paragraph" },
        ],
        citations: [],
      }),
    ).toEqual([{ message: 'citation chip references unknown citation "z"', path: ["body", 2] }]);
  });

  it("refuses an index chip naming an unknown citation, at its index line", () => {
    expect(
      citationIssues({
        body: [],
        citations: [],
        index: [text({ length: 1 }), [chip({ id: "z" })]],
      }),
    ).toEqual([{ message: 'citation chip references unknown citation "z"', path: ["index", 1] }]);
  });

  it("accepts a citation chipped only from the index, and refuses one no run cites", () => {
    expect(
      citationIssues({
        body: [{ runs: text({ length: 1 }), type: "paragraph" }],
        citations: [citation({ id: "a" })],
        index: [[chip({ id: "a" })]],
      }),
    ).toEqual([]);
    expect(
      citationIssues({
        body: [{ runs: [chip({ id: "a" })], type: "paragraph" }],
        citations: [citation({ id: "a" }), citation({ id: "b" })],
        index: [],
      }),
    ).toEqual([{ message: 'citation "b" is defined but no run in body or index cites it', path: ["citations", 1] }]);
  });
});
