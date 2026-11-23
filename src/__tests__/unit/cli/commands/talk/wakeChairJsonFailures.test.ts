/**
 * What `talk wake-chair --json` also says on stderr: every failure its document carries, so the console's background
 * wake, which keeps only stderr, never loses one.
 */
import { describe, expect, it } from "vitest";

import { jsonFailures } from "../../../../../cli/commands/talk/wakeChairRun.js";
import type { ChairWakeReport } from "../../../../../talk/chairWakeShell.js";

const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";
const DROPPED = { detail: "the turn is intended, not registered on the board", kind: "skipped", turnId: TURN } as const;

describe("jsonFailures", () => {
  it("says every failure a woken run carries, dropped requests first", () => {
    const report: ChairWakeReport = {
      dropped: [DROPPED],
      outcome: {
        callId: undefined,
        carried: [],
        delivery: { atIso: "2026-10-30T09:00:00.000Z", detail: "typed into the chair", kind: "typed", via: "courier" },
        kind: "woke",
        line: "[voice batch] …",
        unrecorded: "could not write chair-wake.json: EACCES",
        unsettled: ["the turn could not be written: EACCES"],
      },
      unreadable: undefined,
    };

    expect(jsonFailures({ report })).toEqual([
      `courier request ${TURN} dropped — the turn is intended, not registered on the board`,
      "the wake was not recorded: could not write chair-wake.json: EACCES",
      "a relay stays held for the next batch — the turn could not be written: EACCES",
    ]);
  });

  it("says only the dropped requests of a run that typed nothing", () => {
    const report: ChairWakeReport = {
      dropped: [DROPPED],
      outcome: { kind: "nothing-unread" },
      unreadable: undefined,
    };

    expect(jsonFailures({ report })).toEqual([
      `courier request ${TURN} dropped — the turn is intended, not registered on the board`,
    ]);
  });

  it("says nothing for a clean woken run", () => {
    const report: ChairWakeReport = {
      dropped: [],
      outcome: {
        callId: undefined,
        carried: [],
        delivery: { atIso: "2026-10-30T09:00:00.000Z", detail: "typed into the chair", kind: "typed", via: "courier" },
        kind: "woke",
        line: "[voice batch] …",
        unrecorded: undefined,
        unsettled: [],
      },
      unreadable: undefined,
    };

    expect(jsonFailures({ report })).toEqual([]);
  });
});
