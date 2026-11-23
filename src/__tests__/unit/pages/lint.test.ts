import { describe, expect, it } from "vitest";

import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { lintPageFragment, PageLintFindings } from "../../../pages/lint.js";

/** A page directory holding exactly these relative paths — a plain fake, not a mock. */
function holding({ paths }: { paths: readonly string[] }): (input: { path: string }) => boolean {
  return ({ path }) => paths.includes(path);
}

const EMPTY_DIRECTORY = holding({ paths: [] });

/** An install that knows no repository, Linear workspace or control — the identifier half has nothing to resolve. */
const NO_CONTEXT: BareRefContext = { repos: [] };

describe("lintPageFragment — images", () => {
  it("refuses a file: src, which renders from disk and never from the console", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img src="file:///Users/x/charts/06-serving-blocks-17-30-jul.png" alt="jul">',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([
      PageLintFindings.imageOutsidePage({ src: "file:///Users/x/charts/06-serving-blocks-17-30-jul.png" }),
    ]);
  });

  it("refuses an absolute path, a home path and a climb out of the page directory", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: "<img src='/Users/x/a.png'><img src=~/b.png><img src=\"charts/../../c.png\">",
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings.map((finding) => finding.code)).toStrictEqual([
      "IMAGE_OUTSIDE_PAGE",
      "IMAGE_OUTSIDE_PAGE",
      "IMAGE_OUTSIDE_PAGE",
    ]);
  });

  it("refuses a relative src the page directory does not hold, and passes one it does", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img src="./charts/pool-may.png"><img src="charts/pool-jul.png?v=2">',
      hasPageFile: holding({ paths: ["charts/pool-may.png"] }),
    });
    expect(findings).toStrictEqual([PageLintFindings.imageMissing({ src: "charts/pool-jul.png?v=2" })]);
  });

  it("reads every srcset candidate, and ignores a data-src attribute", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img data-src="file:///x.png" srcset="charts/a.png 1x, file:///b.png 2x" src="charts/a.png">',
      hasPageFile: holding({ paths: ["charts/a.png"] }),
    });
    expect(findings).toStrictEqual([PageLintFindings.imageOutsidePage({ src: "file:///b.png" })]);
  });

  it("passes remote, data and console-served srcs untouched", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment:
        '<img src="https://example.test/a.png"><img src="data:image/png;base64,AAAA"><img src="/api/page/x/a.png"><img src="//cdn.test/b.png">',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([]);
  });

  it("reads srcset candidates as the parser does: a data: URL keeps its comma, a bare comma separates", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img srcset="data:image/png;base64,AAAA 1x,charts/b.png 2x, file:///c.png 3x">',
      hasPageFile: holding({ paths: ["charts/b.png"] }),
    });
    expect(findings).toStrictEqual([PageLintFindings.imageOutsidePage({ src: "file:///c.png" })]);
  });

  it("reads a src after a quoted value that holds a '>'", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img alt="a > b" src="file:///x.png">',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([PageLintFindings.imageOutsidePage({ src: "file:///x.png" })]);
  });

  it("never reads text inside another attribute's quotes as a src", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img alt="was src=file:///old.png" src="charts/a.png">',
      hasPageFile: holding({ paths: ["charts/a.png"] }),
    });
    expect(findings).toStrictEqual([]);
  });

  it("ignores an image inside a comment, which never loads", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<!-- <img src="file:///draft.png"> --><p>x</p>',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([]);
  });

  it("asks the directory for the decoded file name, and for '.' when the src is empty", () => {
    const asked: string[] = [];
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img src="charts/pool%20may.png"><img src="">',
      hasPageFile: ({ path }) => {
        asked.push(path);
        return path === "charts/pool may.png";
      },
    });
    expect(asked).toStrictEqual(["charts/pool may.png", "."]);
    expect(findings).toStrictEqual([PageLintFindings.imageMissing({ src: "" })]);
  });

  it("reports one address once however many times the page uses it", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: '<img src="file:///a.png"><img src="file:///a.png">',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toHaveLength(1);
  });
});

describe("lintPageFragment — timestamps", () => {
  it("refuses an ISO date-time and a zoned clock in prose", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: "<p>Served from 2026-09-23T03:35Z; two dots sit on 21 Sep at 23:35Z.</p>",
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([
      PageLintFindings.rawTimestamp({ stamp: "2026-09-23T03:35Z" }),
      PageLintFindings.rawTimestamp({ stamp: "23:35Z" }),
    ]);
  });

  it("reads the full stamp, seconds, fraction and offset included", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: "<td>2026-10-04T16:07:39.065+11:00</td>",
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([PageLintFindings.rawTimestamp({ stamp: "2026-10-04T16:07:39.065+11:00" })]);
  });

  it("leaves a stamp in code, pre, a comment or an attribute alone", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment:
        '<!-- read 2026-10-03T00:00Z --><p><time datetime="2026-09-23T03:35Z">23 Sep, 2:35 pm</time> and <code>2026-09-23T03:35Z</code></p><pre>at 23:35Z</pre><a href="?ts=2026-09-23T03:35Z">view</a>',
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([]);
  });

  it("passes a bare date and a clock written with a word for its zone", () => {
    const findings = lintPageFragment({
      context: NO_CONTEXT,
      fragment: "<p>On 2026-09-23 at 23:35 UTC, and again at 2:35 pm.</p>",
      hasPageFile: EMPTY_DIRECTORY,
    });
    expect(findings).toStrictEqual([]);
  });

  it("refuses an authored review fold, and a style that could hide the real one", () => {
    const forged = '<details data-page-review="reviewed"><summary>all held</summary></details>';
    const hiding = '<style>details[DATA-PAGE-REVIEW="waived"]{display:none}</style>';
    const escaped = String.raw`<style>[data-page-\72 eview]{display:none}</style>`;
    const escapedChar = String.raw`<style>[data-page-\review]{display:none}</style>`;
    const escapedCrlf = "<style>[data-page-\\72\r\neview]{display:none}</style>";
    for (const fragment of [forged, hiding, escaped, escapedChar, escapedCrlf]) {
      const findings = lintPageFragment({ context: NO_CONTEXT, fragment, hasPageFile: EMPTY_DIRECTORY });
      expect(findings).toStrictEqual([PageLintFindings.authoredReviewFold()]);
    }
  });

  it("finds nothing in an empty fragment", () => {
    expect(lintPageFragment({ context: NO_CONTEXT, fragment: "", hasPageFile: EMPTY_DIRECTORY })).toStrictEqual([]);
  });
});
