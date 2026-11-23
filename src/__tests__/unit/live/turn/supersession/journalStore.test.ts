/*
 * The supersession journal: the rows, the round trip through a real file, and the correlation an audit reads.
 *
 * The store half writes into a `mkdtempSync` home and reads it back — a genuine round trip, the one
 * filesystem use `.claude/rules/testing.md` allows — because the property worth proving is that what the
 * writer emits is what the reader accepts, and two in-memory shapes agreeing proves nothing about that.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  supersessionAttempts,
  supersessionEventLine,
  supersessionIntent,
  supersessionSettled,
} from "../../../../../live/turn/supersession/journal.js";
import {
  appendSupersessionEvent,
  parseSupersessionLog,
  readSupersessionLog,
  supersessionLogPath,
} from "../../../../../live/turn/supersession/store.js";

const TARGET = "1790054484.916599";
const ANSWER = "1790056000.111111";
const TURN = "turn-1790055912004";

const INTENT = supersessionIntent({
  answerTs: ANSWER,
  channel: "C_THREAD",
  reason: "the new answer replaces the affected-version claim",
  supersededTurnId: "turn-1790049846181",
  targetTs: TARGET,
  threadTs: "1790048427.171609",
  tsIso: "2026-09-22T06:25:00.000Z",
  turnId: TURN,
});

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-supersession-"));
  homes.push(dir);
  return dir;
}

describe("the rows", () => {
  it("builds an intent naming both messages, both turns and the reviewer's warrant", () => {
    expect(INTENT).toEqual({
      answerTs: ANSWER,
      channel: "C_THREAD",
      kind: "supersession-intended",
      reason: "the new answer replaces the affected-version claim",
      schemaVersion: 1,
      supersededTurnId: "turn-1790049846181",
      targetTs: TARGET,
      threadTs: "1790048427.171609",
      tsIso: "2026-09-22T06:25:00.000Z",
      turnId: TURN,
    });
  });

  it("leaves `code` and `detail` off a clean delete rather than writing them empty", () => {
    const settled = supersessionSettled({
      outcome: "deleted",
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });

    expect(settled).toEqual({
      kind: "supersession-settled",
      outcome: "deleted",
      schemaVersion: 1,
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
    expect(Object.keys(settled)).not.toContain("code");
  });

  it("carries the domain code AND the human sentence on a refusal, never one instead of the other", () => {
    const settled = supersessionSettled({
      code: "FOREIGN_THREAD",
      detail: "1790054484.916599 was answered in C_OTHER/1790000000.000900",
      outcome: "refused",
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });

    expect(settled.code).toBe("FOREIGN_THREAD");
    expect(settled.detail).toContain("C_OTHER");
  });

  it("serialises one row as a single line of JSON", () => {
    const line = supersessionEventLine({ event: INTENT });

    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(INTENT);
  });
});

describe("the store", () => {
  it("round-trips a row through a real file under the home it was given", () => {
    const home = freshHome();
    appendSupersessionEvent({ event: INTENT, home });

    expect(readSupersessionLog({ home }).events).toEqual([INTENT]);
  });

  it("writes the journal owner-only, and its directory too", () => {
    const home = freshHome();
    appendSupersessionEvent({ event: INTENT, home });
    const path = supersessionLogPath({ home });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
  });

  it("reads an absent journal as an empty result, not as a failure", () => {
    expect(readSupersessionLog({ home: freshHome() })).toEqual({
      events: [],
      readFailure: undefined,
      unreadable: [],
    });
    expect(parseSupersessionLog({ text: "" }).events).toEqual([]);
  });

  // The other half of that pair, and the one found missing: a journal that EXISTS and
  // cannot be opened must not read as the fresh install above, because `atMostOnce.ts` treats an empty
  // list as "never attempted" and would let a repeated turn delete a second time.
  it("reports a journal that exists and cannot be opened, rather than answering no rows", () => {
    const home = freshHome();
    appendSupersessionEvent({ event: INTENT, home });
    chmodSync(supersessionLogPath({ home }), 0o200);
    const read = readSupersessionLog({ home });

    expect(read.events).toEqual([]);
    expect(read.readFailure).toContain("EACCES");
  });

  // Torn tail: a process that died partway through its own append left the journal without a
  // trailing newline, the next row was written straight onto it, and BOTH became one unparseable line —
  // so the fold never saw that pair and a repeated correction deleted a second time.
  it("starts its own line when a torn earlier append left no trailing newline", () => {
    const home = freshHome();
    const path = supersessionLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{", { encoding: "utf8" });
    appendSupersessionEvent({ event: INTENT, home });
    const read = readSupersessionLog({ home });

    expect(read.events).toEqual([INTENT]);
    expect(read.unreadable).toEqual([1]);
  });

  it("keeps both rows of one settled supersession, in the order they were appended", () => {
    const home = freshHome();
    const settled = supersessionSettled({
      outcome: "deleted",
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
    appendSupersessionEvent({ event: INTENT, home });
    appendSupersessionEvent({ event: settled, home });

    expect(readSupersessionLog({ home }).events).toEqual([INTENT, settled]);
  });

  it("reports an unreadable line by number and keeps the readable rows around it", () => {
    const text = `${supersessionEventLine({ event: INTENT })}\n{not json\n${supersessionEventLine({ event: INTENT })}\n`;
    const read = parseSupersessionLog({ text });

    expect(read.unreadable).toEqual([2]);
    expect(read.events.length).toBe(2);
  });

  // Blankness: it was `String.prototype.trim`, which strips every Unicode space, so a line
  // of one vertical tab was skipped in silence while `JSON.parse` rejects it. JSON's own whitespace is the
  // criterion, because a byte that is neither a row nor nothing is the "cannot tell" the guard has to see.
  it("counts a line of non-JSON whitespace as unreadable rather than as blank", () => {
    const read = parseSupersessionLog({ text: "\v\n" });

    expect(read.unreadable).toEqual([1]);
    expect(read.events).toEqual([]);
  });

  it("still skips a line of JSON's own whitespace, which carries no row at all", () => {
    const read = parseSupersessionLog({ text: " \t\n\n" });

    expect(read.unreadable).toEqual([]);
    expect(read.events).toEqual([]);
  });

  it("refuses a settled row whose outcome is outside the closed vocabulary", () => {
    const text = `${JSON.stringify({
      kind: "supersession-settled",
      outcome: "probably-fine",
      schemaVersion: 1,
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    })}\n`;

    expect(parseSupersessionLog({ text }).unreadable).toEqual([1]);
  });

  // Optional fields: `code` and `detail` are optional, and the guard checked only the required fields, so
  // a row whose declared type was a lie read back as well-formed and the journal looked trustworthy.
  it("refuses a settled row whose optional fields are not the strings their type declares", () => {
    const text = `${JSON.stringify({
      code: 42,
      detail: { broken: true },
      kind: "supersession-settled",
      outcome: "refused",
      schemaVersion: 1,
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    })}\n`;

    expect(parseSupersessionLog({ text }).unreadable).toEqual([1]);
  });

  it("refuses a row from a schema version it does not know", () => {
    const text = `${JSON.stringify({ ...INTENT, schemaVersion: 2 })}\n`;

    expect(parseSupersessionLog({ text }).unreadable).toEqual([1]);
  });
});

describe("supersessionAttempts", () => {
  const settled = supersessionSettled({
    outcome: "deleted",
    targetTs: TARGET,
    tsIso: "2026-09-22T06:25:01.000Z",
    turnId: TURN,
  });

  it("pairs an intent with the result that settled it", () => {
    expect(supersessionAttempts({ events: [INTENT, settled] })).toEqual([
      { intent: INTENT, settled, targetTs: TARGET, turnId: TURN },
    ]);
  });

  it("leaves `settled` absent when a session died between the intent and the result", () => {
    const attempts = supersessionAttempts({ events: [INTENT] });

    expect(attempts.length).toBe(1);
    expect(attempts[0]!.settled).toBe(undefined);
  });

  it("carries a refusal that never reached a delete, with no intent to pair it to", () => {
    const refused = supersessionSettled({
      code: "UNREVIEWED",
      detail: "no review verdict judges the supersession",
      outcome: "refused",
      targetTs: TARGET,
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
    const attempts = supersessionAttempts({ events: [refused] });

    expect(attempts[0]!.intent).toBe(undefined);
    expect(attempts[0]!.settled!.code).toBe("UNREVIEWED");
  });

  it("never pairs rows that agree on the turn and disagree on the target", () => {
    const elsewhere = supersessionSettled({
      outcome: "deleted",
      targetTs: "1790050000.000200",
      tsIso: "2026-09-22T06:25:01.000Z",
      turnId: TURN,
    });
    const attempts = supersessionAttempts({ events: [INTENT, elsewhere] });

    expect(attempts.length).toBe(2);
    expect(attempts[0]!.settled).toBe(undefined);
    expect(attempts[1]!.intent).toBe(undefined);
  });
});
