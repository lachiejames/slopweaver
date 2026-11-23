import { describe, expect, it } from "vitest";

import {
  PDF_CHECK_FLAG_NAMES,
  PDF_READ_FLAG_NAMES,
  parsePdfCheckArgs,
  parsePdfReadArgs,
  pdfReadHeader,
  providerReferenceRoute,
  renderPdfCheck,
  renderPdfRead,
} from "../../../../cli/commands/pdf/core.js";
import { unwrap } from "../../../../lib/result.js";
import { GLYPHLESS_LINE, PDF_PAGES_DEFAULT } from "../../../../pdf/limits.js";

describe("parsePdfReadArgs", () => {
  it("takes one path and defaults the page cap", () => {
    const parsed = unwrap(parsePdfReadArgs({ rest: ["./report.pdf"] }));
    expect(parsed.path).toBe("./report.pdf");
    expect(parsed.maxPages).toBe(PDF_PAGES_DEFAULT);
    expect(parsed.json).toBe(false);
  });

  it("refuses no path at all", () => {
    const parsed = parsePdfReadArgs({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toBe("a path to a local PDF is required");
  });

  it("refuses two paths rather than silently reading the first", () => {
    const parsed = parsePdfReadArgs({ rest: ["a.pdf", "b.pdf"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toBe("expected one path, got 2: a.pdf b.pdf");
  });

  it("takes a page cap", () => {
    expect(unwrap(parsePdfReadArgs({ rest: ["a.pdf", "--pages", "3"] })).maxPages).toBe(3);
  });

  it("refuses a page cap that is not a whole number of at least one", () => {
    const parsed = parsePdfReadArgs({ rest: ["a.pdf", "--pages", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toBe("--pages must be a whole number of at least 1, got 0");
  });

  it("names the verb that fetches when handed a URL", () => {
    const parsed = parsePdfReadArgs({ rest: ["https://uploads.linear.app/abc/report.pdf"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("linear attach fetch");
  });

  it("names the verb that fetches when handed a Slack file id", () => {
    const parsed = parsePdfReadArgs({ rest: ["F09ABCDEF12"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("slack read-file");
  });

  it("derives its flag names from the parser's own spec", () => {
    expect(PDF_READ_FLAG_NAMES).toEqual(["--json", "--pages"]);
  });
});

describe("parsePdfCheckArgs", () => {
  it("takes the one flag it accepts", () => {
    expect(unwrap(parsePdfCheckArgs({ rest: ["--json"] })).json).toBe(true);
  });

  it("answers false when the flag is absent", () => {
    expect(unwrap(parsePdfCheckArgs({ rest: [] })).json).toBe(false);
  });

  // Parsed rather than scanned for, so a typo refuses instead of being silently dropped and reporting the
  // terminal rendering as if the caller had asked for it.
  it("refuses a misspelled flag rather than ignoring it", () => {
    const parsed = parsePdfCheckArgs({ rest: ["--jsonn"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--jsonn");
  });

  it("refuses a positional, because the check reads nothing a caller names", () => {
    const parsed = parsePdfCheckArgs({ rest: ["report.pdf"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("report.pdf");
  });

  it("derives its flag names from the parser's own spec", () => {
    expect(PDF_CHECK_FLAG_NAMES).toEqual(["--json"]);
  });
});

describe("providerReferenceRoute", () => {
  it("leaves an ordinary relative path alone", () => {
    expect(providerReferenceRoute({ candidate: "./shots/report.pdf" })).toBe(undefined);
  });

  it("leaves an absolute path alone", () => {
    expect(providerReferenceRoute({ candidate: "/tmp/report.pdf" })).toBe(undefined);
  });

  it("does not mistake a filename that merely starts with F for a Slack id", () => {
    expect(providerReferenceRoute({ candidate: "FINALREPORT.pdf" })).toBe(undefined);
  });
});

describe("renderPdfRead", () => {
  it("prints the header and then the document's own words", () => {
    const rendered = renderPdfRead({
      report: { glyphless: false, pages: 2, pagesRead: 2, path: "a.pdf", text: "line one\nline two" },
    });
    expect(rendered).toBe("a.pdf — 2 page(s)\n\nline one\nline two");
  });

  it("prints the glyphless line INSTEAD of an empty body", () => {
    const rendered = renderPdfRead({
      report: { glyphless: true, pages: 3, pagesRead: 3, path: "scan.pdf", text: "" },
    });
    expect(rendered).toBe(`scan.pdf — 3 page(s)\n${GLYPHLESS_LINE}`);
  });
});

describe("pdfReadHeader", () => {
  it("says how to reach the pages the cap left unread", () => {
    expect(pdfReadHeader({ report: { glyphless: false, pages: 90, pagesRead: 50, path: "a.pdf", text: "x" } })).toBe(
      "a.pdf — 90 page(s), 50 read (raise with --pages)",
    );
  });
});

describe("renderPdfCheck", () => {
  it("names what stopped the extractor when it did not load", () => {
    const rendered = renderPdfCheck({
      report: { bytesMax: 1, extractorLoads: false, pagesDefault: 2, problem: "no standard fonts on this host" },
    });
    expect(rendered).toContain("DID NOT load — no standard fonts on this host");
  });

  it("states that it is not OCR, on the passing arm too", () => {
    const rendered = renderPdfCheck({
      report: { bytesMax: 1, extractorLoads: true, pagesDefault: 2, problem: undefined },
    });
    expect(rendered).toContain("not OCR");
  });
});
