import { describe, expect, it } from "vitest";

import {
  figuresAreCited,
  noReferenceMarkers,
  stripCode,
  urlsAreAnchored,
} from "../../../../../outbound/proposal/lint/evidence.js";
import type { ProposalFinding } from "../../../../../outbound/proposal/lint/findings.js";

/** The uncited-figure finding for a given figure list, spelled out literally. */
function uncited({ figures }: { figures: string }): ProposalFinding {
  return {
    message: `figure(s) with no source nearby: ${figures}. Link the number over its own words, to the run, query or row it came from.`,
    rule: "uncited-figure",
    severity: "blocker",
  };
}

const LINK = "[src](https://example.com/run)";

describe("stripCode", () => {
  it("blanks a fenced block and an inline code span to one space each, leaving prose untouched", () => {
    expect(stripCode({ markdown: "a ```x\n100``` b `c` d" })).toBe("a   b   d");
  });

  it("does not treat an inline span broken across a line as code", () => {
    expect(stripCode({ markdown: "a `10\n0` b" })).toBe("a `10\n0` b");
  });
});

describe("figuresAreCited", () => {
  it("refuses a bare three-digit figure with no source, while a two-digit one is not a figure", () => {
    expect(figuresAreCited({ markdown: "We saw 99 errors." })).toBe(undefined);
    expect(figuresAreCited({ markdown: "We saw 100 errors." })).toEqual(uncited({ figures: "100" }));
  });

  it("refuses unit-bearing figures and percentages however few digits they carry", () => {
    expect(figuresAreCited({ markdown: "p99 took 5ms and 40% failed" })).toEqual(uncited({ figures: "5ms, 40%" }));
  });

  it("names the uncited-figure rule as a blocker with its literal message", () => {
    const finding = figuresAreCited({ markdown: "We saw 100 errors." })!;
    expect(finding.rule).toBe("uncited-figure");
    expect(finding.severity).toBe("blocker");
    expect(finding.message).toBe(
      "figure(s) with no source nearby: 100. Link the number over its own words, to the run, query or row it came from.",
    );
  });

  it("ignores a figure inside fenced or inline code", () => {
    expect(figuresAreCited({ markdown: "```\n100 rows\n```\nand `250ms` there" })).toBe(undefined);
  });

  it("accepts a link ending exactly 200 characters past the figure, and refuses one ending a character later", () => {
    expect(figuresAreCited({ markdown: `100${" ".repeat(200 - LINK.length)}${LINK}` })).toBe(undefined);
    expect(figuresAreCited({ markdown: `100${" ".repeat(201 - LINK.length)}${LINK}` })).toEqual(
      uncited({ figures: "100" }),
    );
  });

  it("accepts a link starting exactly 200 characters before the figure, and refuses one starting a character earlier", () => {
    expect(figuresAreCited({ markdown: `${LINK}${" ".repeat(200 - LINK.length)}100` })).toBe(undefined);
    expect(figuresAreCited({ markdown: `${LINK}${" ".repeat(201 - LINK.length)}100` })).toEqual(
      uncited({ figures: "100" }),
    );
  });

  it("accepts a Slack-form external link as a source", () => {
    expect(figuresAreCited({ markdown: "We saw 100 errors <https://example.com/run|per the run>." })).toBe(undefined);
  });

  it("accepts an in-document anchor that resolves, and refuses one that dangles", () => {
    expect(figuresAreCited({ markdown: 'We saw 100 errors ([run](#run-a)).\n\n<a id="run-a"></a>' })).toBe(undefined);
    expect(figuresAreCited({ markdown: "We saw 100 errors ([run](#run-a))." })).toEqual(uncited({ figures: "100" }));
  });

  it("names only the first five of six uncited figures", () => {
    expect(figuresAreCited({ markdown: "100 200 300 400 500 600" })).toEqual(
      uncited({ figures: "100, 200, 300, 400, 500" }),
    );
  });
});

describe("urlsAreAnchored", () => {
  it("refuses a raw URL in prose with the bare-url rule and its literal message", () => {
    expect(urlsAreAnchored({ markdown: "see https://example.com/path now" })).toEqual({
      message: 'raw URL "https://example.com/path" in prose. Anchor it over the words it supports: [text](url).',
      rule: "bare-url",
      severity: "blocker",
    });
  });

  it("quotes at most the first 60 characters of a long raw URL", () => {
    const url = `https://example.com/${"a".repeat(80)}`;
    expect(urlsAreAnchored({ markdown: `see ${url}` })!.message).toBe(
      `raw URL ${JSON.stringify(url.slice(0, 60))} in prose. Anchor it over the words it supports: [text](url).`,
    );
  });

  it("accepts a URL anchored as a markdown link, an image, a Slack link or inside code", () => {
    expect(urlsAreAnchored({ markdown: "see [the docs](https://example.com/path)" })).toBe(undefined);
    expect(urlsAreAnchored({ markdown: "![chart](https://example.com/chart.png)" })).toBe(undefined);
    expect(urlsAreAnchored({ markdown: "see <https://example.com/path|the docs>" })).toBe(undefined);
    expect(urlsAreAnchored({ markdown: "run `curl https://example.com/path`" })).toBe(undefined);
  });

  it("reports the first raw URL when an anchored one precedes it", () => {
    expect(urlsAreAnchored({ markdown: "[docs](https://example.com/a) then http://example.com/b" })!.message).toBe(
      'raw URL "http://example.com/b" in prose. Anchor it over the words it supports: [text](url).',
    );
  });
});

describe("noReferenceMarkers", () => {
  it("refuses a version marker with the reference-marker rule and its literal message", () => {
    expect(noReferenceMarkers({ markdown: "as shown [v1]." })).toEqual({
      message: "reference marker [v1] in prose. A reader should click the words, not hunt for a footnote.",
      rule: "reference-marker",
      severity: "blocker",
    });
  });

  it("refuses a numeric footnote marker", () => {
    expect(noReferenceMarkers({ markdown: "as shown [12]." })!.message).toBe(
      "reference marker [12] in prose. A reader should click the words, not hunt for a footnote.",
    );
  });

  it("accepts the same brackets when they are a real markdown link, a word, or inside code", () => {
    expect(noReferenceMarkers({ markdown: "see [12](https://example.com/12)" })).toBe(undefined);
    expect(noReferenceMarkers({ markdown: "see [v1](#v1)" })).toBe(undefined);
    expect(noReferenceMarkers({ markdown: "see [notes]" })).toBe(undefined);
    expect(noReferenceMarkers({ markdown: "`arr[1]`" })).toBe(undefined);
  });
});
