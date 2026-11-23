import { describe, expect, it } from "vitest";

import { cadenceFor, recordCadence } from "../../../../../cli/commands/github/landingCadence.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ReadRecord } from "../../../../../review/readJournal.js";
import { ReadJournalErrors } from "../../../../../review/readJournalErrors.js";

const SELECTION = "acme/widgets@ada";
const NOW = new Date("2026-10-31T09:20:00.000Z");
const LAST: ReadRecord = { atIso: "2026-10-31T09:00:00.000Z", dispatchable: 0, rows: 2, selection: SELECTION };
const OUTAGE = ReadJournalErrors.storeUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED (a fixture)" });

describe("cadenceFor", () => {
  it("answers due without reading the cursor when --if-due was not given", async () => {
    const verdict = await cadenceFor({
      cadenceMinutes: 30,
      deps: { now: () => NOW, reads: () => Promise.resolve(err(OUTAGE)) },
      home: undefined,
      ifDue: false,
      selection: SELECTION,
    });

    expect(unwrap(verdict)).toStrictEqual({ kind: "due", lastReadAtIso: undefined, why: "--if-due was not given" });
  });

  it("skips a tick inside the window the last recorded read opened", async () => {
    const verdict = await cadenceFor({
      cadenceMinutes: 30,
      deps: { now: () => NOW, reads: () => Promise.resolve(ok(new Map([[SELECTION, LAST]]))) },
      home: undefined,
      ifDue: true,
      selection: SELECTION,
    });

    expect(unwrap(verdict).kind).toBe("skip");
  });

  it("refuses rather than answering due when the cursor cannot be read", async () => {
    const verdict = await cadenceFor({
      cadenceMinutes: 30,
      deps: { now: () => NOW, reads: () => Promise.resolve(err(OUTAGE)) },
      home: undefined,
      ifDue: true,
      selection: SELECTION,
    });

    expect(unwrapErr(verdict)).toBe(OUTAGE.message);
  });
});

describe("recordCadence", () => {
  it("records the completed read at the clock's instant and exits zero", async () => {
    const written: ReadRecord[] = [];
    const lines: string[] = [];

    const code = await recordCadence({
      deps: {
        now: () => NOW,
        recordRead: ({ record }) => {
          written.push(record);
          return Promise.resolve(ok(record));
        },
        writeDiagnostic: (line) => lines.push(line),
      },
      dispatchable: 1,
      home: undefined,
      rows: 3,
      selection: SELECTION,
    });

    expect(code).toBe(EXIT_OK);
    expect(written).toStrictEqual([{ atIso: NOW.toISOString(), dispatchable: 1, rows: 3, selection: SELECTION }]);
    expect(lines).toStrictEqual([]);
  });

  it("names a lost compare-and-set race in one diagnostic and exits non-zero, never retrying", async () => {
    const conflict = ReadJournalErrors.revisionConflict({ expectedRevision: 1, selection: SELECTION });
    const lines: string[] = [];
    let attempts = 0;

    const code = await recordCadence({
      deps: {
        now: () => NOW,
        recordRead: () => {
          attempts += 1;
          return Promise.resolve(err(conflict));
        },
        writeDiagnostic: (line) => lines.push(line),
      },
      dispatchable: 0,
      home: undefined,
      rows: 0,
      selection: SELECTION,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(attempts).toBe(1);
    expect(lines).toStrictEqual([`github landing: the read completed and was reported, but ${conflict.message}`]);
  });
});
