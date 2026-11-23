import { describe, expect, it } from "vitest";

import { YOUR_LIST_ABOVE_FOLD_MAX_WORDS, YOUR_LIST_MAX_ROWS } from "../../../../briefing/caps.js";
import type { BriefingYourRow } from "../../../../outbound/briefing/types.js";
import { yourListSchema, yourRowAboveFoldWords } from "../../../../outbound/briefing/yourListSchema.js";

/** When the session-start run behind every list here read the world. */
const READ_ISO = "2026-09-01T00:30:00.000Z";

/** One row of the owner's list at `rank`, with a headline of `words` words. */
function row({
  rank,
  words = 4,
  over = {},
}: {
  rank: number;
  words?: number;
  over?: Partial<BriefingYourRow>;
}): BriefingYourRow {
  return {
    closing: false,
    headline: [{ kind: "text", text: Array.from({ length: words }, () => "word").join(" ") }],
    identity: `handover:row-${String(rank)}`,
    link: false,
    rank,
    score: 3,
    whenIso: "2026-09-01T00:00:00.000Z",
    where: "slopweaver handover resume row",
    who: "the row session",
    why: "somebody is stopped waiting on you",
    ...over,
  };
}

/** Every refusal the schema raises over one list, as a reader of the document sees them. */
const refusals = ({ list }: { list: unknown }): readonly string[] => {
  const parsed = yourListSchema.safeParse(list);
  return parsed.error === undefined
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("yourRowAboveFoldWords", () => {
  it("counts the rank, the headline and the title beside it", () => {
    expect(yourRowAboveFoldWords({ row: row({ rank: 3, words: 4, over: { title: "two words" } }) })).toBe(7);
  });

  it("counts the closing mark as the two words it puts on the page", () => {
    expect(yourRowAboveFoldWords({ row: row({ over: { closing: true }, rank: 1, words: 4 }) })).toBe(7);
  });

  it("counts a row with no title at all", () => {
    expect(yourRowAboveFoldWords({ row: row({ rank: 1, words: 2 }) })).toBe(3);
  });
});

/** A review ask's slice: one file of thirty, one line each way. */
const SLICE = {
  additions: 1,
  deletions: 1,
  omittedPaths: 0,
  ownedFiles: 1,
  shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
  totalFiles: 30,
};

describe("yourRowAboveFoldWords with a code-owner slice", () => {
  it("charges the slice's whole line against the fold", () => {
    expect(yourRowAboveFoldWords({ row: row({ over: { codeOwnerSlice: SLICE }, rank: 1, words: 2 }) })).toBe(18);
  });
});

describe("yourListSchema over a code-owner slice", () => {
  const list = ({ slice }: { slice: unknown }) => ({
    notShown: 0,
    readIso: READ_ISO,
    rows: [{ ...row({ rank: 1 }), codeOwnerSlice: slice }],
    source: "slopweaver session-start --json",
  });

  it("accepts a slice whose arithmetic holds", () => {
    expect(refusals({ list: list({ slice: SLICE }) })).toEqual([]);
  });

  it("refuses a slice naming fewer files than it says the owner holds", () => {
    expect(refusals({ list: list({ slice: { ...SLICE, ownedFiles: 2 } }) })).toEqual([
      "rows.0.codeOwnerSlice: a code-owner slice must name or count every file it says the owner holds: shownPaths plus omittedPaths is ownedFiles.",
    ]);
  });

  it("refuses a slice owning more files than the pull request changes", () => {
    expect(refusals({ list: list({ slice: { ...SLICE, totalFiles: 0 } }) })).toEqual([
      "rows.0.codeOwnerSlice: a code-owner slice cannot own more files than the pull request changes.",
    ]);
  });

  it("refuses a key the slice does not declare", () => {
    expect(refusals({ list: list({ slice: { ...SLICE, teams: 3 } }) }).length).toBe(1);
  });
});

describe("yourListSchema", () => {
  it("accepts a ranked list inside its budget", () => {
    const parsed = yourListSchema.safeParse({
      notShown: 4,
      readIso: READ_ISO,
      rows: [row({ rank: 1 }), row({ rank: 2 })],
      source: "slopweaver session-start --json, top 10",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an EMPTY list, because nothing waiting on the owner is a real answer", () => {
    expect(
      refusals({ list: { notShown: 0, readIso: READ_ISO, rows: [], source: "slopweaver session-start --json" } }),
    ).toEqual([]);
  });

  it("refuses rows ranked with a gap, since the page would show a list nobody ranked", () => {
    expect(
      refusals({ list: { notShown: 0, readIso: READ_ISO, rows: [row({ rank: 1 }), row({ rank: 4 })], source: "s" } }),
    ).toEqual(["rows: your list's rows must be ranked from 1 with no gaps — it is a projection of an ordered list."]);
  });

  it("refuses more rows than the cap", () => {
    const rows = Array.from({ length: YOUR_LIST_MAX_ROWS + 1 }, (_, index) => row({ rank: index + 1, words: 1 }));
    expect(refusals({ list: { notShown: 0, readIso: READ_ISO, rows, source: "s" } })).toEqual([
      `rows: Too big: expected array to have <=${String(YOUR_LIST_MAX_ROWS)} items`,
    ]);
  });

  it("refuses a list that runs over the whole section's above-fold budget", () => {
    const rows = Array.from({ length: YOUR_LIST_MAX_ROWS }, (_, index) => row({ rank: index + 1, words: 30 }));
    expect(refusals({ list: { notShown: 0, readIso: READ_ISO, rows, source: "s" } })).toEqual([
      `: your list runs over the cap of ${String(YOUR_LIST_ABOVE_FOLD_MAX_WORDS)} words above the fold. ` +
        "Show fewer rows — the count it is not showing is stated either way.",
    ]);
  });

  it("refuses a read instant no clock can parse, since the section states its age from it", () => {
    expect(refusals({ list: { notShown: 0, readIso: "yesterday", rows: [], source: "s" } })).toEqual([
      "readIso: your list's `readIso` must be an ISO-8601 timestamp a clock can parse, as in " +
        "`2026-09-25T10:49:08Z`.",
    ]);
  });

  it("refuses a key nobody declared, because a strict form never carries one silently", () => {
    expect(refusals({ list: { extra: 1, notShown: 0, readIso: READ_ISO, rows: [], source: "s" } })).toEqual([
      ': unknown field "extra" — REFUSED, not ignored. No field here is close to it, so it is probably a field ' +
        "from another schema.\nthis form's fields are: cutShort, notShown, readIso, rows, source",
    ]);
  });
});
