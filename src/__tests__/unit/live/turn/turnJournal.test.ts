import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import {
  type AnswerEditedRow,
  parseTurnJournal,
  parseTurnJournalLine,
  reviewedBytesStillInHand,
  turnJournalLine,
} from "../../../../live/turn/turnJournal.js";
import { appendTurnJournalRow, readTurnJournal, turnJournalPath } from "../../../../live/turn/turnJournalStore.js";

const ASK: AskIdentity = {
  channel: "CFIXTUREAA",
  messageTs: "1788416854.480579",
  threadTs: "1788412947.233649",
};

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home, removed after the test that minted it. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-journal-"));
  homes.push(home);
  return home;
}

/** An edit row as `turn resume --edit-reason` writes one, with the fields a test wants to vary. */
function edit({ atIso, reason }: { atIso: string; reason: string }): AnswerEditedRow {
  return {
    atIso,
    discardedSendableVerdict: true,
    fromDigest: `sha256:${"a".repeat(64)}`,
    kind: "answer-edited",
    reason,
    toDigest: `sha256:${"b".repeat(64)}`,
  };
}

describe("parseTurnJournal", () => {
  it("reads nothing out of an empty file", () => {
    expect(parseTurnJournal({ text: "" })).toEqual([]);
  });

  it("reads rows back in file order", () => {
    const first = edit({
      atIso: "2026-09-03T07:56:59.568Z",
      reason: "the table omitted the monitor the ask existed for",
    });
    const second = edit({ atIso: "2026-09-03T08:13:02.101Z", reason: "the forecast row cited the wrong dashboard" });
    const rows = parseTurnJournal({ text: `${turnJournalLine({ row: first })}${turnJournalLine({ row: second })}` });
    expect(rows).toEqual([first, second]);
  });

  it("steps over a half-written line rather than losing the whole history to it", () => {
    const row = edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "why" });
    const rows = parseTurnJournal({ text: `{"kind":"answer-ed\n${turnJournalLine({ row })}` });
    expect(rows).toEqual([row]);
  });

  it("drops a row whose shape does not validate", () => {
    expect(
      parseTurnJournal({
        text: '{"kind":"answer-edited","atIso":"x","fromDigest":"sha256:a","toDigest":"sha256:b","reason":""}\n',
      }),
    ).toEqual([]);
  });

  it("drops a row of an unknown kind", () => {
    expect(parseTurnJournal({ text: '{"kind":"something-else","atIso":"2026-09-03T00:00:00.000Z"}\n' })).toEqual([]);
  });
});

describe("the store", () => {
  it("reads an EMPTY journal for a turn that has written nothing", () => {
    expect(readTurnJournal({ askIdentity: ASK, home: tempHome() })).toEqual([]);
  });

  it("appends rows and reads them back in order", () => {
    const home = tempHome();
    const first = edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "first" });
    appendTurnJournalRow({ askIdentity: ASK, home, row: first });
    const second = edit({ atIso: "2026-09-03T08:13:02.101Z", reason: "second" });
    appendTurnJournalRow({ askIdentity: ASK, home, row: second });
    expect(readTurnJournal({ askIdentity: ASK, home })).toEqual([first, second]);
  });

  it("keys the file by channel and addressing timestamp, exactly as the dispatch record is keyed", () => {
    const home = tempHome();
    expect(turnJournalPath({ askIdentity: ASK, home })).toBe(
      join(home, "live", "slack", "turn-journal", "CFIXTUREAA-1788416854.480579.jsonl"),
    );
  });

  it("reads an unreadable journal as empty rather than throwing", () => {
    const home = tempHome();
    appendTurnJournalRow({ askIdentity: ASK, home, row: edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "why" }) });
    writeFileSync(turnJournalPath({ askIdentity: ASK, home }), "not json at all\n", "utf8");
    expect(readTurnJournal({ askIdentity: ASK, home })).toEqual([]);
  });
});

describe("reviewedBytesStillInHand", () => {
  const REVIEWED = `sha256:${"a".repeat(64)}`;
  const MOVED = `sha256:${"b".repeat(64)}`;

  it("holds when nothing has been journalled — no edit ever moved the reviewed bytes", () => {
    expect(reviewedBytesStillInHand({ reviewedDigest: REVIEWED, rows: [] })).toBe(true);
  });

  it("fails once the last edit moved the answer away from the reviewed bytes", () => {
    const rows = [
      { ...edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "tidied" }), fromDigest: REVIEWED, toDigest: MOVED },
    ];
    expect(reviewedBytesStillInHand({ reviewedDigest: REVIEWED, rows })).toBe(false);
  });

  it("holds again when a later edit moved the answer BACK to the reviewed bytes — the door would accept it", () => {
    const rows = [
      { ...edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "tidied" }), fromDigest: REVIEWED, toDigest: MOVED },
      { ...edit({ atIso: "2026-09-03T08:01:00.000Z", reason: "reverted" }), fromDigest: MOVED, toDigest: REVIEWED },
    ];
    expect(reviewedBytesStillInHand({ reviewedDigest: REVIEWED, rows })).toBe(true);
  });

  it("judges by the LAST row, so an old edit to some other round's bytes does not count against this one", () => {
    const rows = [
      { ...edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "round 2 fix" }), fromDigest: MOVED, toDigest: REVIEWED },
    ];
    expect(reviewedBytesStillInHand({ reviewedDigest: REVIEWED, rows })).toBe(true);
  });
});

describe("parseTurnJournalLine", () => {
  it("reads one row", () => {
    const row = edit({ atIso: "2026-09-03T07:56:59.568Z", reason: "why" });
    expect(parseTurnJournalLine({ line: JSON.stringify(row) })).toEqual(row);
  });

  it("answers undefined for a blank line", () => {
    expect(parseTurnJournalLine({ line: "   " })).toBe(undefined);
  });

  it("answers undefined for a half-written line", () => {
    expect(parseTurnJournalLine({ line: '{"kind":"answer-ed' })).toBe(undefined);
  });

  it("answers undefined for a JSON value that is not an object", () => {
    expect(parseTurnJournalLine({ line: '"a string"' })).toBe(undefined);
  });
});
