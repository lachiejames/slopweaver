/** The cap on an authored summary, where it cuts, and the tally of what it dropped. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { BOARD_SUMMARY_CHARS } from "../../../../cli/commands/handover/listJsonRowText.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument's summary cap", () => {
  const HUGE = "x".repeat(BOARD_SUMMARY_CHARS + 500);

  it("cuts an oversized summary to the cap and reports what it dropped", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "fat", summary: HUGE })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows[0]!.summary).toBe("x".repeat(BOARD_SUMMARY_CHARS));
    expect(document.summaryTruncation.cap).toBe(BOARD_SUMMARY_CHARS);
    expect(document.summaryTruncation.measured).toBe(1);
    expect(document.summaryTruncation.truncated).toBe(1);
    expect(document.summaryTruncation.keptChars).toBe(BOARD_SUMMARY_CHARS);
    expect(document.summaryTruncation.droppedChars).toBe(500);
    expect(document.summaryTruncation.longest).toBe(BOARD_SUMMARY_CHARS + 500);
  });

  it("never cuts inside a word, so a URL or key across the cap is never a different valid one", () => {
    const url = "https://github.com/acme/acme-admin/pull/16406";
    const lead = "y".repeat(BOARD_SUMMARY_CHARS - 20);
    const cutOf = ({ summary }: { summary: string }): string | undefined =>
      boardJsonDocument({
        detached: NO_DETACHED_FINDINGS,
        filter: EMPTY_TAG_FILTER,
        handoverDir: "/h",
        models: modelsFor({ docs: [doc({ slug: "cut", summary })] }),
        observedAtIso: OBSERVED,
        references: NO_BOARD_REFERENCES,
        scanStartedIso: SCAN_STARTED,
        unreadable: [],
        unresolved: 0,
      }).rows[0]!.summary;
    expect(cutOf({ summary: `${lead} see ${url} now` })).toBe(`${lead} see`);
    expect(cutOf({ summary: `${"z".repeat(BOARD_SUMMARY_CHARS - 4)} QQQQ-134 next` })).toBe(
      "z".repeat(BOARD_SUMMARY_CHARS - 4),
    );
    expect(cutOf({ summary: `${"w".repeat(BOARD_SUMMARY_CHARS)} tail` })).toBe("w".repeat(BOARD_SUMMARY_CHARS));
  });

  /** The tally is taken off the FULL lengths; reading it off the capped strings would report zero forever. */
  it("measures the longest summary offered, not the longest it kept", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({
        docs: [doc({ slug: "small", summary: "short" }), doc({ slug: "fat", summary: HUGE })],
      }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.summaryTruncation.measured).toBe(2);
    expect(document.summaryTruncation.truncated).toBe(1);
    expect(document.summaryTruncation.longest).toBe(BOARD_SUMMARY_CHARS + 500);
    expect(document.rows.find((row) => row.slug === "small")!.summary).toBe("short");
  });

  /** A summary at or under the cap is passed through byte for byte, and the tally says nothing was lost. */
  it("leaves a summary inside the cap exactly as the doc wrote it", () => {
    const exact = "y".repeat(BOARD_SUMMARY_CHARS);
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "exact", summary: exact })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows[0]!.summary).toBe(exact);
    expect(document.summaryTruncation.truncated).toBe(0);
    expect(document.summaryTruncation.droppedChars).toBe(0);
  });

  /**
   * A doc with no summary at all keeps `undefined` rather than becoming `""`, and is not counted as a
   * record the cap was applied to — "the doc declared none" and "the cap kept zero characters" are
   * different facts about a board.
   */
  it("keeps an absent summary absent, and out of the tally", () => {
    const bare: HandoverDoc = { ...doc({ slug: "bare" }), summary: undefined };
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [bare, doc({ slug: "fat", summary: HUGE })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    expect(document.rows.find((row) => row.slug === "bare")!.summary).toBe(undefined);
    expect(document.summaryTruncation.measured).toBe(1);
    expect(document.summaryTruncation.truncated).toBe(1);
  });
});
