import { describe, expect, it } from "vitest";
// register-class: outbound-small-sample-figure-stated-without-its-n

import type { DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  duplicateSampleIssues,
  type FigureSample,
  SMALL_SAMPLE_THRESHOLD,
  smallSampleIssues,
  unusedSampleIssues,
} from "../../../../outbound/assistant/smallSamples.js";

const NO_INDEX: readonly (readonly InlineRun[])[] = [];
const NO_BODY: readonly DetailBlock[] = [];
const LEAD = "checkout is slow";

/** A one-paragraph body carrying one text run. */
function bodyOf({ text }: { text: string }): readonly DetailBlock[] {
  return [{ runs: [{ text, type: "text" }], type: "paragraph" }];
}

/** The paths of every small-sample issue one body sentence earns against one declared sample. */
function issuePathsOfBody({ text, sample }: { text: string; sample: FigureSample }): readonly string[] {
  return smallSampleIssues({ body: bodyOf({ text }), index: NO_INDEX, lead: LEAD, samples: [sample] }).map((issue) =>
    issue.path.join("."),
  );
}

const SIX: FigureSample = { figure: "12.4s", n: 6 };

describe("smallSampleIssues — a small-sample figure carries its n in the same sentence", () => {
  it("REFUSES a class-C sentence, naming the figure, the n and the fix", () => {
    const issues = smallSampleIssues({
      body: bodyOf({ text: "FixtureCheckout sits at a p50 of 12.4s every day." }),
      index: NO_INDEX,
      lead: LEAD,
      samples: [SIX],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["body.0"]);
    expect(issues[0]!.message).toContain('"12.4s" was computed over n=6, under the small-sample threshold of 50');
    expect(issues[0]!.message).toContain("Write `n=6` into that same sentence");
  });

  it("accepts the same figure once its sentence states the n, parenthesised or not", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s (n=6)." })).toEqual([]);
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s on n = 6 spans." })).toEqual([]);
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s (N=6)." })).toEqual([]);
  });

  it("does not end a sentence at a common abbreviation — the r1 review's second counterexample", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "checkout p50 12.4s vs. 3.2s last week (n=6)" })).toEqual([]);
    expect(issuePathsOfBody({ sample: SIX, text: "the slow ones, e.g. 12.4s, sit on n=6 spans" })).toEqual([]);
  });

  it("REFUSES an n stated in a DIFFERENT sentence of the same item", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s. that was over n=6 spans." })).toEqual(["body.0"]);
  });

  it("REFUSES an n that is not the declared one", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s (n=60)." })).toEqual(["body.0"]);
  });

  it("does not read an n welded to a word as the qualifier", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s on span=6." })).toEqual(["body.0"]);
  });

  it("owes nothing inline at the threshold itself, and the refusal starts one below it", () => {
    const text = "the p50 is 12.4s every day.";
    expect(issuePathsOfBody({ sample: { figure: "12.4s", n: SMALL_SAMPLE_THRESHOLD }, text })).toEqual([]);
    expect(issuePathsOfBody({ sample: { figure: "12.4s", n: SMALL_SAMPLE_THRESHOLD - 1 }, text })).toEqual(["body.0"]);
  });

  it("REFUSES the figure in the lead, which is the placement a reader never has to expand to see", () => {
    const issues = smallSampleIssues({
      body: NO_BODY,
      index: NO_INDEX,
      lead: "checkout p50 is 12.4s and has been all week",
      samples: [SIX],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["lead"]);
  });

  it("REFUSES the figure on an index line, and accepts it once that line carries the n", () => {
    const refused = smallSampleIssues({
      body: NO_BODY,
      index: [[{ text: "checkout p50 12.4s", type: "text" }]],
      lead: LEAD,
      samples: [SIX],
    });
    expect(refused.map((issue) => issue.path.join("."))).toEqual(["index.0"]);
    const accepted = smallSampleIssues({
      body: NO_BODY,
      index: [[{ text: "checkout p50 12.4s (n=6)", type: "text" }]],
      lead: LEAD,
      samples: [SIX],
    });
    expect(accepted).toEqual([]);
  });

  /** A one-row table of operation, p50 and a third column, with the given header and cell for that column. */
  function tableOf({ header, cell }: { header: string; cell: string }): readonly DetailBlock[] {
    return [
      {
        columns: ["operation", "p50", header],
        rows: [
          [
            [{ text: "FixtureReschedule", type: "text" }],
            [{ text: "12.4s", type: "text" }],
            [{ text: cell, type: "text" }],
          ],
        ],
        type: "table",
      },
    ];
  }

  /** The paths of every small-sample issue one such table earns against the n=6 sample. */
  function tablePaths({ header, cell }: { header: string; cell: string }): readonly string[] {
    return smallSampleIssues({ body: tableOf({ cell, header }), index: NO_INDEX, lead: LEAD, samples: [SIX] }).map(
      (issue) => issue.path.join("."),
    );
  }

  it("accepts a row whose column headed n carries the n — the r1 review's counterexample", () => {
    expect(tablePaths({ cell: "6", header: "n" })).toEqual([]);
    expect(tablePaths({ cell: " 6 ", header: " N " })).toEqual([]);
  });

  it("accepts a row that writes n=6 in any cell, and reads the row as one unit", () => {
    expect(tablePaths({ cell: "n=6", header: "sample" })).toEqual([]);
  });

  it("never splits a row at a full stop inside one of its cells, though a paragraph IS split there", () => {
    const row: readonly DetailBlock[] = [
      {
        columns: ["p50", "n"],
        rows: [[[{ text: "12.4s. the slowest", type: "text" }], [{ text: "6", type: "text" }]]],
        type: "table",
      },
    ];
    expect(smallSampleIssues({ body: row, index: NO_INDEX, lead: LEAD, samples: [SIX] })).toEqual([]);
    expect(issuePathsOfBody({ sample: SIX, text: "12.4s. the slowest n=6" })).toEqual(["body.0"]);
  });

  it("REFUSES a row whose n column is empty or carries a different n", () => {
    expect(tablePaths({ cell: "", header: "n" })).toEqual(["body.0.rows.0"]);
    expect(tablePaths({ cell: "60", header: "n" })).toEqual(["body.0.rows.0"]);
  });

  it("REFUSES a bare 6 under a column that is not headed n", () => {
    expect(tablePaths({ cell: "6", header: "count" })).toEqual(["body.0.rows.0"]);
  });

  it("counts a figure worn as a link label, because the reader still sees it with no n beside it", () => {
    const issues = smallSampleIssues({
      body: [
        {
          runs: [
            { text: "the p50 is", type: "text" },
            { label: "12.4s", type: "link", url: "https://app.datadoghq.com/apm/traces" },
          ],
          type: "paragraph",
        },
      ],
      index: NO_INDEX,
      lead: LEAD,
      samples: [SIX],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["body.0"]);
  });

  it("does not find the figure inside a longer number", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 112.4s every day." })).toEqual([]);
    expect(issuePathsOfBody({ sample: { figure: "12", n: 3 }, text: "12% failed, 1,012 rows" })).toEqual([]);
  });

  it("reports one refusal per item, not one per sentence, since both are one edit", () => {
    expect(issuePathsOfBody({ sample: SIX, text: "the p50 is 12.4s. yes, 12.4s." })).toEqual(["body.0"]);
  });
});

describe("unusedSampleIssues — a declared sample must be asserted somewhere", () => {
  it("REFUSES a figure the answer never writes, at its own entry", () => {
    const issues = unusedSampleIssues({
      body: bodyOf({ text: "the p50 is 11.6s (n=6)." }),
      index: NO_INDEX,
      lead: LEAD,
      samples: [SIX],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["samples.0.figure"]);
    expect(issues[0]!.message).toContain('"12.4s" is declared as a sample and asserted nowhere');
  });

  it("accepts an entry whose figure is asserted, at or above the threshold included", () => {
    const issues = unusedSampleIssues({
      body: bodyOf({ text: "the p50 is 12.4s (n=6) and 11.6s." }),
      index: NO_INDEX,
      lead: LEAD,
      samples: [SIX, { figure: "11.6s", n: 202 }],
    });
    expect(issues).toEqual([]);
  });
});

describe("duplicateSampleIssues — one figure has one n", () => {
  it("REFUSES a second entry for the same figure, at the second entry", () => {
    const issues = duplicateSampleIssues({ samples: [SIX, { figure: "11.6s", n: 9 }, { figure: "12.4s", n: 8 }] });
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["samples.2.figure"]);
    expect(issues[0]!.message).toContain('"12.4s" is already declared by an earlier `samples` entry');
  });

  it("accepts distinct figures", () => {
    expect(duplicateSampleIssues({ samples: [SIX, { figure: "11.6s", n: 9 }] })).toEqual([]);
  });
});
