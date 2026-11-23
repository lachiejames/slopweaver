/**
 * What a successful `supervisor tick-record` prints, over a row built by the same pure functions the verb uses.
 */
import { describe, expect, it } from "vitest";

import {
  finaliseSupervisorTick,
  parseSupervisorTickDraft,
} from "../../../../../cli/commands/supervisor/tickRecordCore.js";
import { recordedJson, recordedLine, recordedReport } from "../../../../../cli/commands/supervisor/tickRecordOutput.js";
import { unwrap } from "../../../../../lib/result.js";
import { ownerTurnSnapshotOf } from "../../../../../supervisor/tickOwnerTurns.js";
import { type SupervisorTickRow, TICK_SOURCE_KINDS } from "../../../../../supervisor/tickTypes.js";
import type { UnreadWord } from "../../../../../talk/unreadWords.js";

/** Where the fixture says the row was written. */
const LEDGER = "/tmp/ledger/supervisor-ticks.jsonl";

/**
 * A finalised row carrying one owner turn, with its byte counts pinned so the line's arithmetic is checkable.
 *
 * @returns the row
 */
function row(): SupervisorTickRow {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  const draft = unwrap(
    parseSupervisorTickDraft({
      document: {
        actions: [],
        handoff: "handoff-9226",
        judgements: [],
        sources,
        startedIso: "2026-09-10T12:00:00.000Z",
        tickId: "tick-226-2",
        workspace: "workspace:61",
      },
    }),
  );
  const ownerTurns = unwrap(
    ownerTurnSnapshotOf({
      document: {
        intake: {
          finding: {
            coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
            sinceIso: "2026-09-09T12:00:00.000Z",
            turns: [
              {
                inGrace: false,
                turn: {
                  lineNumber: 1654,
                  pointer: "transcript:a1#t1",
                  sessionId: "a1",
                  source: "typed",
                  text: "lets go with your lean",
                  timestamp: "2026-09-10T11:55:56.547Z",
                  turnUuid: "t1",
                },
                witness: { kind: "row", witness: "derive-the-briefing-narrative-sections-from-the-ledgers" },
              },
            ],
          },
          kind: "read",
        },
      },
    }),
  );
  const finalised = unwrap(finaliseSupervisorTick({ draft, finalisedIso: "2026-09-10T12:20:00.000Z", ownerTurns }));
  return { ...finalised, stats: { ...finalised.stats, judgementUtf8Bytes: 40, structuredUtf8Bytes: 960 } };
}

/** One stretch of the owner's the voice gate passed as still being spoken. */
const STILL_SPOKEN: UnreadWord = {
  atIso: "2026-09-10T12:19:56.000Z",
  callId: "a0000035-0000-4000-8000-000000000038",
  cut: false,
  final: false,
  growingSinceRead: true,
  latestAtIso: "2026-09-10T12:19:56.000Z",
  nextRelay: undefined,
  pointer: "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
  revisions: [],
  segmentId: "segment_0_163",
  text: "and redact the Pino logs",
};

describe("recordedLine", () => {
  it("names the tick, the ledger, the turns stored and the judgement share of the bytes", () => {
    expect(recordedLine({ ledger: LEDGER, row: row() })).toBe(
      "supervisor tick-record: recorded tick tick-226-2 to /tmp/ledger/supervisor-ticks.jsonl — " +
        "1 owner turn(s) stored verbatim (read), 0 action(s), 0 judgement(s) at 40 of 1000 bytes",
    );
  });
});

describe("recordedJson", () => {
  it("carries the same facts one per field, and the pointer of every stretch still being spoken", () => {
    expect(JSON.parse(recordedJson({ ledger: LEDGER, row: row(), stillSpoken: [STILL_SPOKEN] }))).toStrictEqual({
      finalisedIso: "2026-09-10T12:20:00.000Z",
      judgements: 0,
      ledger: LEDGER,
      ownerTurnStatus: "read",
      ownerTurns: 1,
      stillSpoken: ["talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163"],
      tickId: "tick-226-2",
    });
  });

  it("prints an empty still-spoken list when the gate passed none", () => {
    expect(JSON.parse(recordedJson({ ledger: LEDGER, row: row(), stillSpoken: [] })).stillSpoken).toStrictEqual([]);
  });
});

describe("recordedReport", () => {
  it("names each still-spoken stretch on stderr and prints the line on stdout", () => {
    const report = recordedReport({
      json: false,
      ledger: LEDGER,
      row: row(),
      voice: { kind: "clean", stillSpoken: [STILL_SPOKEN] },
    });

    expect(report.diagnostics).toStrictEqual([
      "supervisor tick-record: 1 stretch(es) of the owner's speech are still being spoken, or inside the two-minute quiet " +
        "floor, and do not refuse this tick — each stays unread, and refuses a later tick once the floor has passed " +
        "and it is final, its call ends, or it stops growing:",
      'supervisor tick-record:   2026-09-10T12:19:56.000Z talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163 "and redact the Pino logs"',
    ]);
    expect(report.out).toBe(recordedLine({ ledger: LEDGER, row: row() }));
  });

  it("prints nothing on stderr and the document on stdout for a --json run with none still spoken", () => {
    const report = recordedReport({
      json: true,
      ledger: LEDGER,
      row: row(),
      voice: { kind: "clean", stillSpoken: [] },
    });

    expect(report.diagnostics).toStrictEqual([]);
    expect(report.out).toBe(recordedJson({ ledger: LEDGER, row: row(), stillSpoken: [] }));
  });
});
