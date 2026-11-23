/** The permalink a row publishes out of its summary, read before the cap can remove it. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { BOARD_SUMMARY_CHARS } from "../../../../cli/commands/handover/listJsonRowText.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, modelsFor, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument's summary anchor", () => {
  const LINK = "https://acme.slack.com/archives/C0SYN0043/p1758412345678901";

  it("publishes a permalink the cap would have removed", () => {
    const buried = `${"x".repeat(BOARD_SUMMARY_CHARS + 100)} ${LINK} and then more words`;
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "buried", summary: buried })] }),
      observedAtIso: "2026-09-21T07:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    const row = document.rows.find((candidate) => candidate.slug === "buried")!;
    // The exact capped value rather than "does not contain the link": the summary opens with more than a
    // cap's worth of filler, so what survives is knowable in full, and asserting it says the link is gone
    // AND that nothing else was spliced in to replace it.
    expect(row.summary).toBe("x".repeat(BOARD_SUMMARY_CHARS));
    expect(row.summaryAnchor).toBe(LINK);
  });

  it("trims the punctuation prose wraps a link in", () => {
    const wrapped = `the thread is here (${LINK}).`;
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "wrapped", summary: wrapped })] }),
      observedAtIso: "2026-09-21T07:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    expect(document.rows.find((candidate) => candidate.slug === "wrapped")!.summaryAnchor).toBe(LINK);
  });

  it("takes the FIRST of several links", () => {
    const second = "https://acme.slack.com/archives/C0SYN9ZZ8YY7X/p1758499999999999";
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "two", summary: `${LINK} then ${second}` })] }),
      observedAtIso: "2026-09-21T07:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    expect(document.rows.find((candidate) => candidate.slug === "two")!.summaryAnchor).toBe(LINK);
  });

  it("leaves a summary with no link, and an absent summary, without an anchor", () => {
    const bare: HandoverDoc = { ...doc({ slug: "bare" }), summary: undefined };
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "plain", summary: "no link in here at all" }), bare] }),
      observedAtIso: "2026-09-21T07:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    expect(document.rows.find((candidate) => candidate.slug === "plain")!.summaryAnchor).toBe(undefined);
    expect(document.rows.find((candidate) => candidate.slug === "bare")!.summaryAnchor).toBe(undefined);
  });
});
