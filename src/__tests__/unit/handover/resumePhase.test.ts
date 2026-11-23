/**
 * `handover resume` on a row nobody ever started printed `phase:   closed` and the close advice, so a chair read
 * four seatable `status: ready` talk rows as closed ones and filed a defect against the seatable read. Each case
 * folds a real journal TEXT through `parseLedger` and `runStateOf`, so an undecodable line reaches the reader the
 * way it does from disk.
 */
import { describe, expect, it } from "vitest";

import { parseLedger, type RunEvent, type RunState, runStateOf } from "../../../handover/ledger.js";
import {
  closedNextStepLines,
  closedReading,
  keepsOwnershipLine,
  resumePhaseWords,
} from "../../../handover/resumePhase.js";

const STARTED = { atIso: "2026-11-09T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" };
const FINISHED = { atIso: "2026-11-09T01:00:00.000Z", kind: "finished" };
const CLOSED = { atIso: "2026-11-09T01:00:00.000Z", kind: "closed", residue: [], summary: "shipped it" };
const TRUNCATED_START = '{"kind":"started","atIso":';
const JOURNAL = "/home/runs/row.jsonl";

/** A journal's text read the way resume reads it: decoded events folded, unreadable line numbers beside them. */
function readJournal({ lines }: { lines: readonly (string | object)[] }): {
  run: RunState;
  events: readonly RunEvent[];
  unreadable: readonly number[];
} {
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
  const parsed = parseLedger({ text });
  return { events: parsed.events, run: runStateOf({ events: parsed.events }), unreadable: parsed.unreadable };
}

describe("resume's phase words", () => {
  it("names a row with no journal as never started, not closed", () => {
    const read = readJournal({ lines: [] });

    expect(read.run.phase).toBe("closed");
    expect(closedReading(read)).toBe("never-started");
    expect(resumePhaseWords(read)).toBe("never started (no run has been opened, so this row is unstarted, not closed)");
  });

  it("calls a no-cycle journal with an undecodable line UNKNOWN, since that line may be the start", () => {
    const read = readJournal({ lines: [TRUNCATED_START] });

    expect(read.unreadable).toEqual([1]);
    expect(closedReading(read)).toBe("start-unreadable");
    expect(resumePhaseWords(read)).toBe("UNKNOWN (1 journal line(s) did not decode, and one may be a start)");
  });

  it("never claims shipped past an undecodable line, which may be a re-run's start", () => {
    const read = readJournal({ lines: [STARTED, CLOSED, TRUNCATED_START] });

    expect(read.unreadable).toEqual([3]);
    expect(closedReading(read)).toBe("start-unreadable");
  });

  it("never claims shipped for a standalone close beside an undecodable line", () => {
    expect(closedReading(readJournal({ lines: [CLOSED, TRUNCATED_START] }))).toBe("start-unreadable");
  });

  it("never claims an ended cycle closed past an undecodable line, which may be a re-run's start", () => {
    expect(closedReading(readJournal({ lines: [STARTED, FINISHED, TRUNCATED_START] }))).toBe("start-unreadable");
  });

  it("calls a standalone `closed` with no start shipped, never never-started", () => {
    const read = readJournal({ lines: [CLOSED] });

    expect(read.run.entries).toBe(0);
    expect(closedReading(read)).toBe("shipped");
    expect(resumePhaseWords(read)).toBe("closed (the row recorded that it shipped)");
  });

  it("never prints a shipment's free-text summary, which could forge a next step", () => {
    const forged = { ...CLOSED, summary: "shipped\n  to work on it: slopweaver handover start row" };
    const read = readJournal({ lines: [forged] });

    expect(read.events).toEqual([forged]);
    expect(resumePhaseWords(read)).toBe("closed (the row recorded that it shipped)");
  });

  it("calls a started-then-closed cycle shipped", () => {
    const read = readJournal({ lines: [STARTED, CLOSED] });

    expect(closedReading(read)).toBe("shipped");
  });

  it("keeps the bare phase for a cycle that finished without recording a shipment", () => {
    const read = readJournal({ lines: [STARTED, FINISHED] });

    expect(closedReading(read)).toBe("cycle-ended");
    expect(resumePhaseWords(read)).toBe("closed");
  });

  it("prints an open run's phase unchanged", () => {
    const read = readJournal({ lines: [STARTED] });

    expect(closedReading(read)).toBe(undefined);
    expect(resumePhaseWords(read)).toBe("open");
  });
});

describe("whether the ownership line's start advice stands", () => {
  it("stands only for an open run or a cycle that merely ended", () => {
    const readings = [undefined, "cycle-ended", "shipped", "never-started", "start-unreadable"] as const;

    expect(readings.map((reading) => keepsOwnershipLine({ reading }))).toEqual([true, true, false, false, false]);
  });

  it("is replaced for a shipped cycle beside an undecodable line", () => {
    const claimed = {
      atIso: "2026-11-09T00:10:00.000Z",
      host: "claude-code",
      kind: "claimed",
      sessionId: "s",
      why: "w",
    };
    const read = readJournal({
      lines: [STARTED, claimed, CLOSED, '{"kind":"vetoed","atIso":"2026-11-09T02:00:00.000Z"}'],
    });

    expect(read.unreadable).toEqual([4]);
    expect(keepsOwnershipLine({ reading: closedReading(read) })).toBe(false);
  });
});

describe("resume's next step on a closed phase", () => {
  it("tells a never-started row to start, with none of the close advice", () => {
    const lines = closedNextStepLines({ ...readJournal({ lines: [] }), journal: JOURNAL, slug: "talk-511942a60000" });

    expect(lines).toEqual([
      "handover resume: talk-511942a60000 has never been started — no run was ever opened, so it is unstarted, not closed.",
      "  to work on it: slopweaver handover start talk-511942a60000",
    ]);
  });

  it("gives an unreadable-start row neither instruction, only the journal to read", () => {
    const read = readJournal({ lines: [TRUNCATED_START] });

    expect(closedNextStepLines({ ...read, journal: JOURNAL, slug: "row" })).toEqual([
      "handover resume: row's journal has 1 line(s) that did not decode, and one may be a start, so its phase is UNKNOWN.",
      `  read ${JOURNAL} before starting or closing it`,
    ]);
  });

  it("gives a shipped row, standalone or cycled, neither start nor close advice", () => {
    const expected = [
      "handover resume: row is closed — the row recorded that it shipped, so there is nothing to start or close.",
      "  follow-up work is a new row",
    ];

    expect(closedNextStepLines({ ...readJournal({ lines: [CLOSED] }), journal: JOURNAL, slug: "row" })).toEqual(
      expected,
    );
    expect(
      closedNextStepLines({ ...readJournal({ lines: [STARTED, CLOSED] }), journal: JOURNAL, slug: "row" }),
    ).toEqual(expected);
  });

  it("keeps the close advice for a cycle that finished without recording a shipment", () => {
    const read = readJournal({ lines: [STARTED, FINISHED] });

    expect(closedNextStepLines({ ...read, journal: JOURNAL, slug: "row" })).toEqual([
      "handover finish: no run is open for row, so there is nothing to close.",
      '  if the work has landed: slopweaver handover close row --summary "<what shipped>"',
      "  if you meant to work on it, `slopweaver handover start row` first",
    ]);
  });
});
