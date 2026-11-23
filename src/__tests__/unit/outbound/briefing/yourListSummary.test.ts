/*
 * The one line a reader meets on the owner's folded list: its row count, the read's age in words, and — cut short at a
 * deadline — what the run did not read.
 */
import { describe, expect, it } from "vitest";

import { yourListSummary } from "../../../../outbound/briefing/yourListSummary.js";
import { yourRow } from "./render/harness.js";

const READ = "2026-09-06T02:00:00.000Z";

describe("yourListSummary", () => {
  it("states the read's age in minutes under an hour, and hours and minutes past one", () => {
    const list = { notShown: 0, readIso: READ, rows: [yourRow({ over: {} })], source: "session-start" };

    expect(yourListSummary({ list, readyIso: "2026-09-06T02:47:00.000Z" })).toBe(
      "1 ranked rows — read 47 minutes before this page was rendered",
    );
    expect(yourListSummary({ list, readyIso: "2026-09-06T05:47:00.000Z" })).toBe(
      "1 ranked rows — read 3 hours 47 minutes before this page was rendered",
    );
    expect(yourListSummary({ list, readyIso: "2026-09-06T04:00:00.000Z" })).toBe(
      "1 ranked rows — read 2 hours before this page was rendered",
    );
  });

  it("names every part a list cut short did not read", () => {
    const list = {
      cutShort: ["your mail", "the live re-read"],
      notShown: 0,
      readIso: READ,
      rows: [],
      source: "session-start",
    };

    expect(yourListSummary({ list, readyIso: READ })).toBe(
      "0 ranked rows — read 0 minutes before this page was rendered. Cut short, not read: your mail, the live re-read",
    );
  });
});
