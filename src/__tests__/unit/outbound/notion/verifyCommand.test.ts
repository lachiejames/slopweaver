/**
 * The verify sentence every Notion write verb ends on: the exact command it names, and the two lines a write
 * prints. A URL carrying a query and a fragment is interpolated verbatim, never re-encoded or trimmed.
 */
import { describe, expect, it } from "vitest";

import { verifyCommandFor, verifyReminderLines } from "../../../../outbound/notion/verifyCommand.js";

const PAGE = "https://www.notion.so/team/Runbook-0123456789abcdef0123456789abcdef";
const PAGE_WITH_QUERY = "https://www.notion.so/team/Runbook-0123?pvs=4&v=a%20b#block-42";

describe("verifyCommandFor", () => {
  it("names the notion verify verb on the page URL", () => {
    expect(verifyCommandFor({ pageUrl: PAGE })).toBe(
      "slopweaver notion verify https://www.notion.so/team/Runbook-0123456789abcdef0123456789abcdef",
    );
  });

  it("keeps a query string and a fragment exactly as given", () => {
    expect(verifyCommandFor({ pageUrl: PAGE_WITH_QUERY })).toBe(
      "slopweaver notion verify https://www.notion.so/team/Runbook-0123?pvs=4&v=a%20b#block-42",
    );
  });
});

describe("verifyReminderLines", () => {
  it("prints the not-verified warning, then the command to run", () => {
    expect(verifyReminderLines({ pageUrl: PAGE_WITH_QUERY })).toEqual([
      "NOT verified yet: what you sent is markdown, and what a reader sees is Notion's conversion of it.",
      "Open it and check:  slopweaver notion verify https://www.notion.so/team/Runbook-0123?pvs=4&v=a%20b#block-42",
    ]);
  });
});
