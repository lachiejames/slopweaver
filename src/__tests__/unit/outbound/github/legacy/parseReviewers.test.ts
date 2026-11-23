import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { ReadingOrderErrors } from "../../../../../outbound/github/legacy/errors.js";
import { parseReadingOrderBody } from "../../../../../outbound/github/legacy/parse.js";
import { reviewersSection } from "../../../../../outbound/github/legacy/parseReviewers.js";
import { LAYOUT, renderStampedBody } from "../../../../../outbound/github/legacy/render.js";
import type { ReviewerRow, StampedPrBody } from "../../../../../outbound/github/legacy/types.js";
import { MINIMAL_BODY } from "./fixtures.js";

/** A table block holding `rows`, as the renderer lays it out. */
function table({ rows }: { rows: readonly string[] }): string {
  return ["<table>", LAYOUT.reviewersHeader, ...rows, "</table>"].join("\n");
}

describe("reviewersSection", () => {
  it("consumes nothing when the body carries no table", () => {
    const cursor = { at: 0, blocks: ["## What can go wrong"] };
    expect(unwrap(reviewersSection({ cursor }))).toBe(undefined);
    expect(cursor.at).toBe(0);
  });

  it("reads a picked person, the team they stand in for, listed files and Everything else", () => {
    const rows = [
      '<tr><td><a name="reviewers-quinn"></a>@quinn for <code>@org/platform</code></td><td><code>a.ts</code><br><code>b.ts</code></td></tr>',
      '<tr><td><a name="reviewers-org-eng"></a>@org/eng</td><td>Everything else</td></tr>',
    ];
    const cursor = { at: 0, blocks: [LAYOUT.reviewersHeading, table({ rows })] };
    expect(unwrap(reviewersSection({ cursor }))).toEqual([
      { look: { files: ["a.ts", "b.ts"], kind: "files" }, standsInFor: ["@org/platform"], who: ["@quinn"] },
      { look: { kind: "rest" }, standsInFor: [], who: ["@org/eng"] },
    ]);
    expect(cursor.at).toBe(2);
  });

  it("reads a folded files cell", () => {
    const rows = [
      '<tr><td><a name="reviewers-a"></a>@a</td><td><details><summary>2 files</summary><code>x.ts</code><br><code>y.ts</code></details></td></tr>',
    ];
    const cursor = { at: 0, blocks: [LAYOUT.reviewersHeading, table({ rows })] };
    expect(unwrap(reviewersSection({ cursor }))).toEqual([
      { look: { files: ["x.ts", "y.ts"], kind: "files" }, standsInFor: [], who: ["@a"] },
    ]);
  });

  it("refuses a row that does not read, rather than skipping it", () => {
    const cursor = { at: 0, blocks: [LAYOUT.reviewersHeading, table({ rows: ["<tr><td>@a</td><td>x</td></tr>"] })] };
    expect(reviewersSection({ cursor })._unsafeUnwrapErr()).toEqual(
      ReadingOrderErrors.structure({ at: "a Who reviews what row" }),
    );
  });
});

/** Seven files, so the cell folds past the inline cap. */
const SEVEN = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((name) => `packages/infra/${name}.ts`);

const ROWS: readonly ReviewerRow[] = [
  { look: { files: ["apps/helpbot/a&b.ts"], kind: "files" }, standsInFor: ["@org/platform"], who: ["@quinn"] },
  { look: { files: SEVEN, kind: "files" }, standsInFor: [], who: ["@org/platform", "@jonah"] },
  { look: { kind: "rest" }, standsInFor: [], who: ["@lionel"] },
];

const WITH_TABLE: StampedPrBody = { ...MINIMAL_BODY, reviewers: ROWS };

/** The body's bytes with the plain badge row and sentence risk rows. */
function bytes({ body }: { body: StampedPrBody }): string {
  return unwrap(renderStampedBody({ anchor: undefined, badges: "plain", body, riskRows: "sentence" }));
}

describe("the Who reviews what section of a whole reading-order body", () => {
  it("renders right under the badge row, every row anchored, a long file list folded", () => {
    const blocks = bytes({ body: WITH_TABLE }).split("\n\n");
    expect(blocks[1]).toBe(LAYOUT.reviewersHeading);
    expect(blocks[2]).toBe(
      [
        "<table>",
        "<tr><th>Reviewer</th><th>Look at</th></tr>",
        '<tr><td><a name="reviewers-quinn"></a>@quinn for <code>@org/platform</code></td>' +
          "<td><code>apps/helpbot/a&amp;b.ts</code></td></tr>",
        '<tr><td><a name="reviewers-org-platform-jonah"></a>@org/platform or @jonah</td><td><details><summary>7 files' +
          `</summary>${SEVEN.map((file) => `<code>${file}</code>`).join("<br>")}</details></td></tr>`,
        '<tr><td><a name="reviewers-lionel"></a>@lionel</td><td>Everything else</td></tr>',
        "</table>",
      ].join("\n"),
    );
    expect(blocks[3]).toBe(LAYOUT.riskHeading);
  });

  it("reads back into the exact rows that rendered it", () => {
    expect(unwrap(parseReadingOrderBody({ body: bytes({ body: WITH_TABLE }) })).body.reviewers).toEqual(ROWS);
  });

  it("renders nothing, and reads back nothing, when the body has no table", () => {
    const body = bytes({ body: MINIMAL_BODY });
    expect(body.includes(LAYOUT.reviewersHeading)).toBe(false);
    expect(unwrap(parseReadingOrderBody({ body })).body.reviewers).toBe(undefined);
  });
});
