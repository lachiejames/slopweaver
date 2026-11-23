/*
 * `alreadyAttempted` — the pure half of the at-most-once guard.
 *
 * Its own file because the question it answers is a fold over rows, with no clock, no home and no Slack in
 * it: every case here is a literal journal and a verdict. The ORDER this guard sits in, and what a second
 * `settleSupersession` actually does, belong to `run.test.ts` and are asserted there against the real shell.
 */
import { describe, expect, it } from "vitest";

import { alreadyAttempted, journalReadFailure } from "../../../../../live/turn/supersession/atMostOnce.js";
import { type SupersessionAttempt, supersessionIntent } from "../../../../../live/turn/supersession/journal.js";

const TURN = "turn-1790055912004";
const TARGET = "1790054484.916599";
const OTHER_TARGET = "1790061193.442100";
const OTHER_TURN = "turn-1790061200000";
const INTENDED_ISO = "2026-09-22T06:25:01.000Z";

/** One folded attempt, with whichever halves a case needs. */
function attempt({
  turnId = TURN,
  targetTs = TARGET,
  intended = true,
}: {
  turnId?: string;
  targetTs?: string;
  intended?: boolean;
} = {}): SupersessionAttempt {
  return {
    // Built by the REAL writer, per `testing.md`: a row hand-rolled here would keep passing the day the
    // factory stops matching its own type.
    intent: intended
      ? supersessionIntent({
          answerTs: "1790056000.111111",
          channel: "C_THREAD",
          reason: "the new answer replaces the affected-version claim",
          supersededTurnId: "turn-1790049846181",
          targetTs,
          threadTs: "1790048427.171609",
          tsIso: INTENDED_ISO,
          turnId,
        })
      : undefined,
    settled: undefined,
    targetTs,
    turnId,
  };
}

describe("alreadyAttempted", () => {
  it("passes an empty journal — the first correction this install ever makes", () => {
    expect(alreadyAttempted({ attempts: [], readFailure: undefined, targetTs: TARGET, turnId: TURN })).toBeUndefined();
  });

  it("refuses when this exact pair already journalled an intent, naming the instant it carries", () => {
    const refusal = alreadyAttempted({
      attempts: [attempt()],
      readFailure: undefined,
      targetTs: TARGET,
      turnId: TURN,
    });

    expect(refusal!.code).toBe("ALREADY_ATTEMPTED");
    expect(refusal!.message).toBe(
      `this turn already journalled an intent to delete ${TARGET} at ${INTENDED_ISO} — a delete is ` +
        "attempted at most once per turn and target, whatever that first attempt went on to report",
    );
  });

  it("passes the same turn against a DIFFERENT target", () => {
    const attempts = [attempt({ targetTs: OTHER_TARGET })];

    expect(alreadyAttempted({ attempts, readFailure: undefined, targetTs: TARGET, turnId: TURN })).toBeUndefined();
  });

  it("passes the same target against a DIFFERENT turn", () => {
    const attempts = [attempt({ turnId: OTHER_TURN })];

    expect(alreadyAttempted({ attempts, readFailure: undefined, targetTs: TARGET, turnId: TURN })).toBeUndefined();
  });

  // A refusal with no intent row is a check that said no before any delete was attempted, so there is
  // nothing to be at-most-once about. Judging on the pair's presence alone would refuse a legitimate retry
  // of a turn whose first run never reached the door.
  it("passes a matching pair whose journal holds a refusal and no intent", () => {
    const attempts = [attempt({ intended: false })];

    expect(alreadyAttempted({ attempts, readFailure: undefined, targetTs: TARGET, turnId: TURN })).toBeUndefined();
  });

  // The counterexample: `readSupersessionLog` used to catch every open failure and answer
  // an empty list, so an unreadable journal said "never attempted" and a repeated turn deleted twice.
  it("refuses an unreadable journal, naming what the read failed with", () => {
    const refusal = alreadyAttempted({
      attempts: [],
      readFailure: "EACCES: permission denied, open 'supersessions.jsonl'",
      targetTs: TARGET,
      turnId: TURN,
    });

    expect(refusal!.code).toBe("JOURNAL_UNREADABLE");
    expect(refusal!.message).toBe(
      `the supersession journal could not be read, so whether this turn already tried to delete ${TARGET} ` +
        "is unknown — EACCES: permission denied, open 'supersessions.jsonl'",
    );
  });

  it("refuses an unreadable journal even when the rows it did return carry no matching pair", () => {
    const attempts = [attempt({ turnId: OTHER_TURN })];
    const refusal = alreadyAttempted({ attempts, readFailure: "EIO: i/o error", targetTs: TARGET, turnId: TURN });

    expect(refusal!.code).toBe("JOURNAL_UNREADABLE");
  });
});

describe("journalReadFailure", () => {
  it("trusts a read where every line parsed", () => {
    expect(journalReadFailure({ readFailure: undefined, unreadable: [] })).toBeUndefined();
  });

  it("carries a failed open through as it stands", () => {
    expect(journalReadFailure({ readFailure: "EACCES: permission denied", unreadable: [] })).toBe(
      "EACCES: permission denied",
    );
  });

  // The torn-tail counterexample: a torn tail turned one intent row into an unparseable line. The AUDIT may
  // read past that line; this guard may not, because the line it skipped is the row it came to look for.
  it("names the lines it could not parse, because one of them may be the row being asked about", () => {
    expect(journalReadFailure({ readFailure: undefined, unreadable: [2, 5] })).toBe(
      "line(s) 2, 5 could not be parsed, and one of them may be the intent row that names this pair",
    );
  });

  it("prefers the failed open when a read reports both", () => {
    expect(journalReadFailure({ readFailure: "EIO: i/o error", unreadable: [3] })).toBe("EIO: i/o error");
  });
});
