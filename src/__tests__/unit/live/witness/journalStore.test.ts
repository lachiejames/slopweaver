import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { appendWitnessEvent, readWitnessJournal, witnessJournalPath } from "../../../../live/witness/journalStore.js";
import { type WitnessSettledEvent, witnessIdOf } from "../../../../live/witness/types.js";

const KEY = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };

const EVENT: WitnessSettledEvent = {
  ...KEY,
  kind: "settled",
  outcome: "nothing-checkable",
  schemaVersion: 1,
  tsIso: "2026-10-05T00:00:00.000Z",
  witnessId: witnessIdOf({ key: KEY }),
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "witness-journal-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("the witness journal store", () => {
  it("lives at live/slack/witness-outcomes.jsonl under the home", () => {
    expect(witnessJournalPath({ home })).toBe(join(home, "live", "slack", "witness-outcomes.jsonl"));
  });

  it("reads a journal that does not exist yet as empty", () => {
    expect(unwrap(readWitnessJournal({ home }))).toEqual([]);
  });

  it("round-trips appended events in order", () => {
    const second: WitnessSettledEvent = { ...EVENT, tsIso: "2026-10-05T00:01:00.000Z" };
    unwrap(appendWitnessEvent({ event: EVENT, home }));
    unwrap(appendWitnessEvent({ event: second, home }));

    expect(unwrap(readWitnessJournal({ home }))).toEqual([EVENT, second]);
  });

  it("refuses the whole journal on one malformed line, naming it, even with good lines around it", () => {
    unwrap(appendWitnessEvent({ event: EVENT, home }));
    appendFileSync(witnessJournalPath({ home }), "{torn\n");
    unwrap(appendWitnessEvent({ event: EVENT, home }));
    const error = unwrapErr(readWitnessJournal({ home }));

    expect(error.code).toBe("JOURNAL_LINE_MALFORMED");
    expect(error.message).toContain("line 2");
  });

  it("skips a whitespace-only line rather than refusing it", () => {
    const path = witnessJournalPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, " \t\n");
    unwrap(appendWitnessEvent({ event: EVENT, home }));

    expect(unwrap(readWitnessJournal({ home }))).toEqual([EVENT]);
  });

  it("reports an append that cannot land as a typed write failure", () => {
    const path = witnessJournalPath({ home });
    mkdirSync(path, { recursive: true });
    const error = unwrapErr(appendWitnessEvent({ event: EVENT, home }));

    expect(error.code).toBe("JOURNAL_WRITE_FAILED");
  });

  it("reports a journal path it cannot open as unreadable, not empty", () => {
    mkdirSync(witnessJournalPath({ home }), { recursive: true });
    const error = unwrapErr(readWitnessJournal({ home }));

    expect(error.code).toBe("JOURNAL_UNREADABLE");
  });
});
