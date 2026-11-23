/**
 * Round-trip fidelity, tested against the normalisations Linear was MEASURED to apply — confirmed live on
 * issue SECU-66: `-` bullets rewritten to `*`, and a bare autolink expanded to `[url](<url>)`.
 *
 * These are the cases that used to pass silently — the verb read the body back, used it for the ledger
 * digest, and never compared it to what it sent.
 */
import { describe, expect, it } from "vitest";

import { compareStoredBody, fidelityLines, MAX_REPORTED_DIFFERENCES } from "../../../../outbound/linear/fidelity.js";

describe("compareStoredBody", () => {
  it("reports an exact round-trip as identical", () => {
    const body = "## Problem\n\nit broke\n";

    expect(compareStoredBody({ sent: body, stored: body })).toEqual({
      differences: [],
      identical: true,
      missing: false,
      sentLines: 4,
      storedLines: 4,
    });
  });

  it("catches a bullet marker rewritten from - to *, the measured normalisation", () => {
    const report = compareStoredBody({ sent: "## Solution\n\n- first", stored: "## Solution\n\n* first" });

    expect(report.identical).toBe(false);
    expect(report.differences).toEqual([{ line: 3, sent: "- first", stored: "* first" }]);
  });

  it("catches a fourth +++ line where three were sent", () => {
    const report = compareStoredBody({ sent: "a\n+++\nb\n+++", stored: "a\n+++\nb\n+++\n+++" });

    expect(report.sentLines).toBe(4);
    expect(report.storedLines).toBe(5);
    expect(report.differences).toEqual([{ line: 5, sent: undefined, stored: "+++" }]);
  });

  it("catches a bare autolink expanded to a full markdown link, as measured on SECU-66", () => {
    const report = compareStoredBody({
      sent: "see <https://x.test/a>",
      stored: "see [https://x.test/a](<https://x.test/a>)",
    });

    expect(report.differences).toEqual([
      { line: 1, sent: "see <https://x.test/a>", stored: "see [https://x.test/a](<https://x.test/a>)" },
    ]);
  });

  it("reports every differing line, not just the first", () => {
    const report = compareStoredBody({ sent: "- a\n- b\n- c", stored: "* a\n- b\n* c" });

    expect(report.differences.map((d) => d.line)).toEqual([1, 3]);
  });

  it("reports a truncated body as differences plus a shorter stored length", () => {
    const report = compareStoredBody({ sent: "a\nb\nc", stored: "a" });

    expect(report.storedLines).toBe(1);
    expect(report.differences).toEqual([
      { line: 2, sent: "b", stored: undefined },
      { line: 3, sent: "c", stored: undefined },
    ]);
  });

  it("treats an absent description as missing rather than as an empty body", () => {
    const report = compareStoredBody({ sent: "a\nb", stored: undefined });

    expect(report.missing).toBe(true);
    expect(report.identical).toBe(false);
    expect(report.storedLines).toBe(0);
    expect(report.differences).toEqual([]);
  });

  it("treats an emptied body as a real difference, distinct from missing", () => {
    const report = compareStoredBody({ sent: "a", stored: "" });

    expect(report.missing).toBe(false);
    expect(report.differences).toEqual([{ line: 1, sent: "a", stored: "" }]);
  });

  it("calls two empty bodies identical", () => {
    expect(compareStoredBody({ sent: "", stored: "" }).identical).toBe(true);
  });
});

describe("fidelityLines", () => {
  it("says so out loud when the round-trip was exact, rather than staying silent", () => {
    const body = "## Problem\n\nit broke";

    expect(fidelityLines({ report: compareStoredBody({ sent: body, stored: body }) })).toEqual([
      "body verified: Linear stored all 3 line(s) exactly as sent",
    ]);
  });

  it("names the changed line, both sides, and that the issue still filed", () => {
    const report = compareStoredBody({ sent: "## Solution\n\n- first", stored: "## Solution\n\n* first" });

    expect(fidelityLines({ report })).toEqual([
      "Linear normalised the body: 1 of 3 line(s) differ from what was sent.",
      '  line 3: sent "- first" → stored "* first"',
      "The issue is filed; this is Linear's storage format, not an error. The ledger tracks the STORED form.",
    ]);
  });

  it("shows an absent line as absent rather than as an empty string", () => {
    const report = compareStoredBody({ sent: "a", stored: "a\nb" });

    expect(fidelityLines({ report })[1]).toBe('  line 2: sent (no such line) → stored "b"');
  });

  it("caps the named lines and counts the remainder", () => {
    const sent = Array.from({ length: 9 }, (_, index) => `- item ${String(index)}`).join("\n");
    const stored = Array.from({ length: 9 }, (_, index) => `* item ${String(index)}`).join("\n");
    const lines = fidelityLines({ report: compareStoredBody({ sent, stored }) });

    expect(lines[0]).toBe("Linear normalised the body: 9 of 9 line(s) differ from what was sent.");
    expect(lines).toContain(`  …and ${String(9 - MAX_REPORTED_DIFFERENCES)} more`);
    expect(lines.filter((line) => line.startsWith("  line ")).length).toBe(MAX_REPORTED_DIFFERENCES);
  });

  it("reports an unverifiable body distinctly from a normalised one", () => {
    expect(fidelityLines({ report: compareStoredBody({ sent: "a", stored: undefined }) })).toEqual([
      "Linear returned no description on read-back, so the stored body could NOT be verified.",
    ]);
  });
});
