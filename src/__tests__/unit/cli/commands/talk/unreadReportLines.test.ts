/**
 * The plain-text lines `talk unread` prints for one read, at their edges: nothing unread, and a stretch whose answer
 * was never read. The batched shape is `unreadReport.test.ts`'s, through the report that calls these.
 */
import { describe, expect, it } from "vitest";

import { printedAnswerLines, reportLines } from "../../../../../cli/commands/talk/unreadReportLines.js";

const NOW = "2026-10-30T09:00:00.000Z";

describe("reportLines", () => {
  it("says nothing new, and heads no batch, for a read with nothing unread and no relay held", () => {
    expect(
      reportLines({
        answers: new Map(),
        nowIso: NOW,
        relays: [],
        scope: "since the chair's cursor",
        selection: { beforeFloor: 0, foreign: [], unparseable: [], words: [] },
      }),
    ).toEqual(["talk unread: nothing new from them since the chair's cursor"]);
  });
});

describe("printedAnswerLines", () => {
  it("says what the words answered was not read when no context was", () => {
    expect(printedAnswerLines({ context: undefined, relayPrinted: true })).toEqual([
      "  what these words answered was not read: read the call before judging them",
    ]);
  });
});
