import { describe, expect, it } from "vitest";
// register-class: outbound-figure-asserted-with-no-measurement

import type { DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  duplicateMeasurementIssues,
  type FigureMeasurement,
  figuresInAnswer,
  unmeasuredFigureIssues,
  unusedMeasurementIssues,
} from "../../../../outbound/assistant/measuredFigures.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";

const CONTEXT: BareRefContext = {
  complianceControls: [{ id: "HRS-52", url: "https://app.vanta.com/c/acme/controls?controlId=0syn0002" }],
  repos: [{ owner: "acme", repo: "slopweaver" }],
};

const NO_INDEX: readonly (readonly InlineRun[])[] = [];
const NO_BODY: readonly DetailBlock[] = [];
const NO_MEASUREMENTS: readonly FigureMeasurement[] = [];

/** A paragraph of the given runs. */
function paragraph({ runs }: { runs: readonly InlineRun[] }): DetailBlock {
  return { runs, type: "paragraph" };
}

/** A one-paragraph body carrying one text run. */
function bodyOf({ text }: { text: string }): readonly DetailBlock[] {
  return [paragraph({ runs: [{ text, type: "text" }] })];
}

/** Every figure the scanner finds in one sentence of body prose. */
function figuresOf({ text }: { text: string }): readonly string[] {
  return figuresInAnswer({ body: bodyOf({ text }), context: CONTEXT, index: NO_INDEX, lead: "lead" }).map(
    (span) => span.figure,
  );
}

describe("figuresInAnswer — what counts as a figure", () => {
  it("finds a thousands-separated count", () => {
    expect(figuresOf({ text: "91,131 was the daily max" })).toEqual(["91,131"]);
  });

  it("finds a bare three-digit and a bare four-digit count", () => {
    expect(figuresOf({ text: "227 controls across 1208 rows" })).toEqual(["227", "1208"]);
  });

  it("finds a percentage, and keeps the percent sign in the figure", () => {
    expect(figuresOf({ text: "49% of them fired" })).toEqual(["49%"]);
  });

  it("finds a percentage carrying a decimal, which the decimal mask must not eat", () => {
    expect(figuresOf({ text: "98.7% of them are passing" })).toEqual(["98.7%"]);
  });

  it("keeps the decimal percentage AND the counts beside it in one sentence", () => {
    // The r1 review's counterexample: the counts were found and the percentage silently was not, so the
    // answer was refused into shape for two of its three numbers and shipped the third unmeasured.
    expect(figuresOf({ text: "12.5% failed, 1,771 of 3,349" })).toEqual(["12.5%", "1,771", "3,349"]);
  });

  it("keeps a decimal percentage below the leading-zero boundary", () => {
    expect(figuresOf({ text: "0.1% of the fleet" })).toEqual(["0.1%"]);
  });

  it("keeps the percent sign on a percentage above 999, which the thousands arm used to swallow", () => {
    // The r2 review's second counterexample: reported as `1,200`, a composer writing their own `1,200%`
    // tripped the one refusal that has no hatch.
    expect(figuresOf({ text: "growth of 1,200% this month" })).toEqual(["1,200%"]);
  });

  it("finds every figure in one sentence, in reading order", () => {
    expect(figuresOf({ text: "1,771 of 3,349 alerts, 98% inside 236 monitors" })).toEqual([
      "1,771",
      "3,349",
      "98%",
      "236",
    ]);
  });

  it("scans the lead, which is where the headline number sits", () => {
    const spans = figuresInAnswer({
      body: NO_BODY,
      context: CONTEXT,
      index: NO_INDEX,
      lead: "7,049 alerts in the window",
    });
    expect(spans.length).toBe(1);
    expect(spans[0]!.figure).toBe("7,049");
    expect(spans[0]!.path).toEqual(["lead"]);
  });

  it("names the table ROW a figure sits in, not the block", () => {
    const table: DetailBlock = {
      columns: ["which", "how many"],
      rows: [
        [[{ text: "first", type: "text" }], [{ text: "108 hits", type: "text" }]],
        [[{ text: "second", type: "text" }], [{ text: "249 hits", type: "text" }]],
      ],
      type: "table",
    };
    const spans = figuresInAnswer({ body: [table], context: CONTEXT, index: NO_INDEX, lead: "lead" });
    expect(spans.map((span) => span.figure)).toEqual(["108", "249"]);
    expect(spans[0]!.path).toEqual(["body", 0, "rows", 0]);
    expect(spans[1]!.path).toEqual(["body", 0, "rows", 1]);
  });
});

describe("figuresInAnswer — what is masked, and why", () => {
  it("ignores a count below the magnitude floor a reader can count for themselves", () => {
    expect(figuresOf({ text: "the table carries exactly 5 rows and 3 of 4 checks are green" })).toEqual([]);
  });

  it("ignores an ISO date and an ISO datetime", () => {
    expect(figuresOf({ text: "read 2026-09-20 and again at 2026-09-20T07:21:47.694Z" })).toEqual([]);
  });

  it("ignores a clock time", () => {
    expect(figuresOf({ text: "the rollup was read 18:15 and 09:30:15" })).toEqual([]);
  });

  it("ignores a bare year", () => {
    expect(figuresOf({ text: "this held through 2025 and 2026" })).toEqual([]);
  });

  it("ignores a dotted version", () => {
    expect(figuresOf({ text: "TypeScript 6.0 on Yarn 4.9.2" })).toEqual([]);
  });

  it("ignores a leading-zero run, which is a padded field rather than a quantity", () => {
    expect(figuresOf({ text: "slot 0004 of 0012" })).toEqual([]);
  });

  it("keeps a thousands group that starts with a zero, which the leading-zero mask must not eat", () => {
    expect(figuresOf({ text: "7,049 alerts and 1,008 more" })).toEqual(["7,049", "1,008"]);
  });

  it("ignores a decimal with no percent sign, which measures zero in the reviewed corpus", () => {
    expect(figuresOf({ text: "the pool held 1,208.5 average rows and $1,250.00 of spend" })).toEqual([]);
  });

  it("still ignores a dotted version once the decimal mask has a right boundary", () => {
    expect(figuresOf({ text: "TypeScript 6.0 on Yarn 4.9.2 across 227 files" })).toEqual(["227"]);
  });

  it("ignores a bare run of five or more digits, because that magnitude is an identifier", () => {
    expect(figuresOf({ text: "monitor 1000004 and monitor 50100 fired" })).toEqual([]);
  });

  it("still finds a thousands-separated count of the magnitude the bare-run mask excludes", () => {
    expect(figuresOf({ text: "14,180 alerts against monitor 600105" })).toEqual(["14,180"]);
  });

  it("ignores a digit run welded to a word", () => {
    expect(figuresOf({ text: "sha256 of the p90 on claude-opus-5" })).toEqual([]);
  });

  it("ignores a bare GitHub reference, which is an identifier the bare-ref pass owns", () => {
    expect(figuresOf({ text: "#917 landed and #916 did not" })).toEqual([]);
  });

  it("ignores a compliance control id of the same digit shape", () => {
    expect(figuresOf({ text: "HRS-52 is one test away" })).toEqual([]);
  });

  it("ignores a figure written as a link, because it already points at what produced it", () => {
    const linked: readonly DetailBlock[] = [
      paragraph({ runs: [{ label: "344 claims", type: "link", url: "https://example.internal/claims" }] }),
    ];
    expect(figuresInAnswer({ body: linked, context: CONTEXT, index: NO_INDEX, lead: "lead" })).toEqual([]);
  });
});

describe("unmeasuredFigureIssues", () => {
  it("refuses a figure with no measurement covering it, naming the figure and the path", () => {
    const issues = unmeasuredFigureIssues({
      body: bodyOf({ text: "227 monitors have never fired" }),
      context: CONTEXT,
      index: NO_INDEX,
      lead: "lead",
      measurements: NO_MEASUREMENTS,
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["body", 0]);
    expect(issues[0]!.message).toContain('"227" is asserted here with nothing saying how it was measured');
  });

  it("accepts a figure a measurement entry covers", () => {
    expect(
      unmeasuredFigureIssues({
        body: bodyOf({ text: "227 monitors have never fired" }),
        context: CONTEXT,
        index: NO_INDEX,
        lead: "lead",
        measurements: [
          { figures: ["227"], repro: "slopweaver atlas datadog --unfired", takenAtIso: "2026-09-20T07:00:00.000Z" },
        ],
      }),
    ).toEqual([]);
  });

  it("lets ONE entry cover every figure one command produced", () => {
    expect(
      unmeasuredFigureIssues({
        body: bodyOf({ text: "1,771 of 3,349 alerts, 98% inside 236 monitors" }),
        context: CONTEXT,
        index: NO_INDEX,
        lead: "lead",
        measurements: [
          {
            figures: ["1,771", "3,349", "98%", "236"],
            repro: "slopweaver atlas datadog --alerts --window 30d",
            takenAtIso: "2026-09-20T07:00:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("reports one issue per DISTINCT figure, not one per mention", () => {
    const issues = unmeasuredFigureIssues({
      body: [
        paragraph({ runs: [{ text: "227 monitors", type: "text" }] }),
        paragraph({ runs: [{ text: "227 monitors again, plus 108 more", type: "text" }] }),
      ],
      context: CONTEXT,
      index: NO_INDEX,
      lead: "lead",
      measurements: NO_MEASUREMENTS,
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      ["body", 0],
      ["body", 1],
    ]);
    expect(issues[0]!.message).toContain('"227"');
    expect(issues[1]!.message).toContain('"108"');
  });

  it("refuses an answer asserting a figure only in its lead", () => {
    const issues = unmeasuredFigureIssues({
      body: NO_BODY,
      context: CONTEXT,
      index: NO_INDEX,
      lead: "7,049 alerts in the window",
      measurements: NO_MEASUREMENTS,
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["lead"]);
  });

  it("accepts an answer that asserts no figure at all", () => {
    expect(
      unmeasuredFigureIssues({
        body: bodyOf({ text: "the pool exhausted because the lease never returned" }),
        context: CONTEXT,
        index: NO_INDEX,
        lead: "here is what happened",
        measurements: NO_MEASUREMENTS,
      }),
    ).toEqual([]);
  });
});

describe("unusedMeasurementIssues", () => {
  it("refuses an entry naming a figure the answer never asserts, naming its position", () => {
    const issues = unusedMeasurementIssues({
      body: bodyOf({ text: "227 monitors have never fired" }),
      context: CONTEXT,
      index: NO_INDEX,
      lead: "lead",
      measurements: [
        {
          figures: ["227", "999"],
          repro: "slopweaver atlas datadog --unfired",
          takenAtIso: "2026-09-20T07:00:00.000Z",
        },
      ],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["measurements", 0, "figures", 1]);
    expect(issues[0]!.message).toContain('"999" is measured here and asserted nowhere in the answer');
  });

  it("accepts a measurement list every entry of which the answer asserts", () => {
    expect(
      unusedMeasurementIssues({
        body: bodyOf({ text: "227 monitors, 49% of the fleet" }),
        context: CONTEXT,
        index: NO_INDEX,
        lead: "lead",
        measurements: [
          { figures: ["227"], repro: "slopweaver atlas datadog --unfired", takenAtIso: "2026-09-20T07:00:00.000Z" },
          { figures: ["49%"], repro: "slopweaver atlas datadog --share", takenAtIso: "2026-09-20T07:00:00.000Z" },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts an empty measurement list", () => {
    expect(
      unusedMeasurementIssues({
        body: bodyOf({ text: "nothing quantified here" }),
        context: CONTEXT,
        index: NO_INDEX,
        lead: "lead",
        measurements: NO_MEASUREMENTS,
      }),
    ).toEqual([]);
  });
});

describe("duplicateMeasurementIssues", () => {
  it("refuses a second entry covering a figure an earlier entry already covers", () => {
    const issues = duplicateMeasurementIssues({
      measurements: [
        { figures: ["227"], repro: "slopweaver atlas datadog --unfired", takenAtIso: "2026-09-20T07:00:00.000Z" },
        { figures: ["227"], repro: "slopweaver atlas datadog --again", takenAtIso: "2026-09-20T07:05:00.000Z" },
      ],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["measurements", 1, "figures", 0]);
    expect(issues[0]!.message).toContain('"227" is already covered by an earlier `measurements` entry');
  });

  it("refuses a figure repeated inside ONE entry, at its own position", () => {
    const issues = duplicateMeasurementIssues({
      measurements: [
        { figures: ["227", "49%", "227"], repro: "slopweaver atlas datadog", takenAtIso: "2026-09-20T07:00:00.000Z" },
      ],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["measurements", 0, "figures", 2]);
  });

  it("bounds the list the r2 review broke: forty entries naming one figure yield thirty-nine refusals", () => {
    const measurements: readonly FigureMeasurement[] = Array.from({ length: 40 }, (_unused, index) => ({
      figures: ["227"],
      repro: `command number ${String(index)}`,
      takenAtIso: "2026-09-20T07:00:00.000Z",
    }));
    expect(duplicateMeasurementIssues({ measurements }).length).toBe(39);
  });

  it("accepts a list whose every entry covers a different figure", () => {
    expect(
      duplicateMeasurementIssues({
        measurements: [
          { figures: ["227", "49%"], repro: "slopweaver atlas datadog", takenAtIso: "2026-09-20T07:00:00.000Z" },
          { figures: ["1,208"], repro: "slopweaver catalog --count", takenAtIso: "2026-09-20T07:00:00.000Z" },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts an empty measurement list", () => {
    expect(duplicateMeasurementIssues({ measurements: NO_MEASUREMENTS })).toEqual([]);
  });
});
