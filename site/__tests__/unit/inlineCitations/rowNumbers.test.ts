import { describe, expect, it } from "vitest";

import { type CardReferences, inlinePlain, inlineSegments } from "../../../lib/inlineCitations";
import { ACME_ADMIN, pr, SECU } from "./fixtures";

/*
 * A number or key no address names, resolved through what the row knows instead: a drawer for acme-admin 16406 whose
 * ask carried no address at all still shows every plain-text PR number and Linear ticket id as a link.
 */
describe("inlineSegments with the row's references", () => {
  it("links every number and key the 16406 drawer's title, what, problem and option name", () => {
    expect(
      inlineSegments({
        references: ACME_ADMIN,
        text: "Decide 16406, the booking seed draft: take it forward with 16400, rebase it alone, or close it?",
      }),
    ).toEqual([
      { kind: "text", text: "Decide " },
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: ", the booking seed draft: take it forward with " },
      { kind: "cite", label: "16400", url: pr({ n: 16400 }) },
      { kind: "text", text: ", rebase it alone, or close it?" },
    ]);
    expect(
      inlineSegments({
        references: ACME_ADMIN,
        text: "16406 (QQQQ-134, seed a booking subject): it stacks on 16400, converted back to draft last week.",
      }),
    ).toEqual([
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " (" },
      { kind: "cite", label: "QQQQ-134", url: SECU },
      { kind: "text", text: ", seed a booking subject): it stacks on " },
      { kind: "cite", label: "16400", url: pr({ n: 16400 }) },
      { kind: "text", text: ", converted back to draft last week." },
    ]);
    expect(
      inlinePlain({
        references: ACME_ADMIN,
        text: "16406 can't land while its base 16400 is a draft, since last week",
      }),
    ).toBe("16406 can't land while its base 16400 is a draft, since last week");
  });

  it("links a bare #N and `repo N` through the home repository with no address carried", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "see #16406 and acme-admin 16400" })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "#16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " and " },
      { kind: "cite", label: "acme-admin 16400", url: pr({ n: 16400 }) },
    ]);
  });

  it("keeps dates, times, decimals, fractions, amounts, years and short counts as words", () => {
    const text =
      "25 Sep 2026 at 11:15, 14.6h ago, 93/93 green, 1,339,505 bytes, $12345, €12345, £12345, $ 16400, € 16400, USD 16400, 16400 / 16406, Sep 25, 2026, 16 September, 12345ms, 16400 - 16406, 16400–16406, 16400 — 16406, 30 rows, option #1";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([{ kind: "text", text }]);
  });

  it("keeps a same-length count before a unit as words, and `repo N` before one — `18 lines / 3,297 bytes`", () => {
    const text = "10000 rows, 16406 Lines, 12000 bytes, 16400 tokens, 16401 KiB, 16402 MB, acme-admin 16403 characters";
    expect(inlineSegments({ references: ACME_ADMIN, text })).toEqual([{ kind: "text", text }]);
    expect(
      inlineSegments({
        references: ACME_ADMIN,
        text: "16406 lined up, 16400 tests the seed, 16401 records it, 16402 token refresh",
      }),
    ).toEqual([
      { kind: "cite", label: "16406", url: pr({ n: 16406 }) },
      { kind: "text", text: " lined up, " },
      { kind: "cite", label: "16400", url: pr({ n: 16400 }) },
      { kind: "text", text: " tests the seed, " },
      { kind: "cite", label: "16401", url: pr({ n: 16401 }) },
      { kind: "text", text: " records it, " },
      { kind: "cite", label: "16402", url: pr({ n: 16402 }) },
      { kind: "text", text: " token refresh" },
    ]);
  });

  it("links a same-length count as a pull request — the trade the ruling takes", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "10000 of them" })).toEqual([
      { kind: "cite", label: "10000", url: pr({ n: 10000 }) },
      { kind: "text", text: " of them" },
    ]);
  });

  it("keeps a number another repository names as words, and a year on a four-digit repository", () => {
    const slopweaver: CardReferences = { ...ACME_ADMIN, home: "lachiejames/slopweaver" };
    expect(inlineSegments({ references: ACME_ADMIN, text: "slopweaver 16406" })).toEqual([
      { kind: "text", text: "slopweaver 16406" },
    ]);
    expect(inlineSegments({ references: ACME_ADMIN, text: "Backport slopweaver #16406" })).toEqual([
      { kind: "text", text: "Backport slopweaver #16406" },
    ]);
    expect(inlineSegments({ references: slopweaver, text: "merged as 1280 in 2026" })).toEqual([
      { kind: "text", text: "merged as " },
      { kind: "cite", label: "1280", url: "https://github.com/lachiejames/slopweaver/pull/1280" },
      { kind: "text", text: " in 2026" },
    ]);
  });

  it("keeps a same-length number well past the attested end as words — slopweaver's live `port 3000`", () => {
    const slopweaver: CardReferences = { ...ACME_ADMIN, home: "lachiejames/slopweaver" };
    expect(inlineSegments({ references: slopweaver, text: "on port 3000, since 1400" })).toEqual([
      { kind: "text", text: "on port 3000, since " },
      { kind: "cite", label: "1400", url: "https://github.com/lachiejames/slopweaver/pull/1400" },
    ]);
    expect(inlineSegments({ references: slopweaver, text: "see #3000" })).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "#3000", url: "https://github.com/lachiejames/slopweaver/pull/3000" },
    ]);
  });

  it("keeps an in-range number after a value noun as words, as in `port: 1000`", () => {
    const slopweaver: CardReferences = { ...ACME_ADMIN, home: "lachiejames/slopweaver" };
    const text =
      "listen on port: 1000, port #1010, Port 1100, PORT 1110, port number 1120, Line No. 1130, PID 1200, line 1204, version 1210, exit code 1220";
    expect(inlineSegments({ references: slopweaver, text })).toEqual([{ kind: "text", text }]);
    expect(inlineSegments({ references: slopweaver, text: "ported 1230" })).toEqual([
      { kind: "text", text: "ported " },
      { kind: "cite", label: "1230", url: "https://github.com/lachiejames/slopweaver/pull/1230" },
    ]);
  });

  it("keeps a number or key the carried addresses claim but disagree on as words", () => {
    const known = [pr({ n: 16406 }), "https://github.com/another/repo/pull/16406"];
    expect(inlineSegments({ known, references: ACME_ADMIN, text: "#16406 and 16406" })).toEqual([
      { kind: "text", text: "#16406 and 16406" },
    ]);
    expect(
      inlineSegments({
        known: ["https://linear.app/acme/issue/QQQQ-134/a", "https://linear.app/other/issue/QQQQ-134/b"],
        references: ACME_ADMIN,
        text: "QQQQ-134",
      }),
    ).toEqual([{ kind: "text", text: "QQQQ-134" }]);
  });

  it("links a bare number the row carries ONE address for to that address", () => {
    const known = [pr({ n: 17680 }), pr({ n: 17344 }), pr({ n: 93 })];
    const text = "17680 already does it and 17344's job is done; keep 17344. CI 93";
    expect(inlineSegments({ known, references: { ...ACME_ADMIN, home: undefined }, text })).toEqual([
      { kind: "cite", label: "17680", url: pr({ n: 17680 }) },
      { kind: "text", text: " already does it and " },
      { kind: "cite", label: "17344", url: pr({ n: 17344 }) },
      { kind: "text", text: "'s job is done; keep " },
      { kind: "cite", label: "17344", url: pr({ n: 17344 }) },
      { kind: "text", text: ". CI 93" },
    ]);
  });

  it("links a number the home cannot hold to the ONE other repository the row names", () => {
    const slopweaverAsk: CardReferences = {
      ...ACME_ADMIN,
      home: "lachiejames/slopweaver",
      named: ["acme/acme-admin"],
    };
    const text = "the one commit past the archive tag (#17594), and 17594";
    expect(inlineSegments({ references: slopweaverAsk, text })).toEqual([
      { kind: "text", text: "the one commit past the archive tag (" },
      { kind: "cite", label: "#17594", url: pr({ n: 17594 }) },
      { kind: "text", text: "), and " },
      { kind: "cite", label: "17594", url: pr({ n: 17594 }) },
    ]);
    expect(
      inlineSegments({
        references: {
          ...slopweaverAsk,
          attested: new Map([...ACME_ADMIN.attested, ["acme/other", 19000]]),
          checkouts: new Set([...ACME_ADMIN.checkouts, "acme/other"]),
          named: [],
        },
        text,
      }),
    ).toEqual([{ kind: "text", text }]);
    expect(
      inlineSegments({
        references: {
          ...slopweaverAsk,
          attested: new Map([...ACME_ADMIN.attested, ["acme/other", 19000]]),
          named: ["acme/acme-admin", "acme/other"],
        },
        text,
      }),
    ).toEqual([{ kind: "text", text }]);
    expect(inlineSegments({ references: { ...slopweaverAsk, named: ["acme/unattested"] }, text: "#17594" })).toEqual([
      { kind: "text", text: "#17594" },
    ]);
  });

  it("reads a Linear address with and without its title slug as one issue", () => {
    const known = [SECU, `${SECU}/seed-a-booking-subject`];
    expect(
      inlineSegments({ known, references: { ...ACME_ADMIN, linearWorkspace: undefined }, text: "see QQQQ-134" }),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "cite", label: "QQQQ-134", url: SECU },
    ]);
  });

  it("links a `PR N` naming no repository through home like a `#N`, and a home-named number no longer than home's", () => {
    expect(inlineSegments({ references: ACME_ADMIN, text: "PR 478, acme-admin 123456, acme-admin PR 123456" })).toEqual(
      [
        { kind: "cite", label: "PR 478", url: pr({ n: 478 }) },
        { kind: "text", text: ", acme-admin 123456, acme-admin PR 123456" },
      ],
    );
  });

  it("links a value noun's #N only through a carried address, as in `timeout #N`", () => {
    const one = "https://github.com/lachiejames/slopweaver/pull/898";
    expect(
      inlineSegments({ known: [one], references: ACME_ADMIN, text: "the timeout #898 landed; port #1010" }),
    ).toEqual([
      { kind: "text", text: "the timeout " },
      { kind: "cite", label: "#898", url: one },
      { kind: "text", text: " landed; port #1010" },
    ]);
  });
});
