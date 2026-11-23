/**
 * The summary's seal: what a derived file looks like, and every edit that breaks it.
 */
import { describe, expect, it } from "vitest";

import {
  checkSummary,
  DERIVE_SUMMARY_HINT,
  sealSummary,
  summaryMarker,
  unsealedSummaryLines,
} from "../../../../supervisor/outcomes/summaryMarker.js";

const BODY = "# Successor summary\n\nnobody is on gcp-backups.";

describe("sealSummary and checkSummary", () => {
  it("seals a body with its own digest and reads the counts back", () => {
    const sealed = sealSummary({ body: BODY, outcomes: 12, ready: 457 });

    expect(sealed.startsWith(summaryMarker({ body: BODY, outcomes: 12, ready: 457 }))).toBe(true);
    expect(checkSummary({ text: sealed })).toEqual({ kind: "sealed", outcomes: 12, ready: 457 });
  });

  it("refuses a file nobody derived", () => {
    const checked = checkSummary({ text: "# Successor summary\n\nI typed this myself.\n" });

    expect(checked.kind).toBe("unsealed");
    expect((checked as Extract<typeof checked, { kind: "unsealed" }>).why).toContain("not a");
  });

  it("refuses a derived file somebody edited afterwards", () => {
    const edited = sealSummary({ body: BODY, outcomes: 12, ready: 457 }).replace("nobody is", "everybody is");

    const checked = checkSummary({ text: edited });

    expect(checked.kind).toBe("unsealed");
    expect((checked as Extract<typeof checked, { kind: "unsealed" }>).why).toContain("does not hash");
  });

  it("refuses a marker whose own shape is wrong rather than reading half of it", () => {
    const checked = checkSummary({ text: "<!-- slopweaver successor-summary sha256:nope -->\nbody\n" });

    expect(checked.kind).toBe("unsealed");
    expect((checked as Extract<typeof checked, { kind: "unsealed" }>).why).toContain("malformed");
  });

  it("refuses a file that is one line, with nothing under the marker at all", () => {
    const checked = checkSummary({ text: summaryMarker({ body: BODY, outcomes: 1, ready: 1 }) });

    expect(checked.kind).toBe("unsealed");
  });

  it("refuses a correctly sealed EMPTY body, which hashes fine and says nothing", () => {
    const checked = checkSummary({ text: sealSummary({ body: "   ", outcomes: 0, ready: 0 }) });

    expect(checked.kind).toBe("unsealed");
    expect((checked as Extract<typeof checked, { kind: "unsealed" }>).why).toContain("no body");
  });
});

describe("unsealedSummaryLines", () => {
  it("names the file, carries the verdict's own reason, and ends in the one command that fixes it", () => {
    expect(unsealedSummaryLines({ path: "/s/summary.md", why: "its marker line is malformed" })).toEqual([
      "/s/summary.md is not a derived successor summary: its marker line is malformed.",
      DERIVE_SUMMARY_HINT,
    ]);
  });
});
