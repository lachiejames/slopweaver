/**
 * `handover currency --record-reading <by>`'s ledger step: the exact append it makes — observed at the document's own
 * `checkedIso`, never the append clock — the one serialisation `--json` prints and the ledger stores, and the exit a
 * refused append earns, round-tripped through a throwaway home.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CURRENCY_PRODUCER,
  currencyDocumentText,
  currencyOutputOf,
  currencyReadingRecordInput,
  recordCurrencyReading,
  recordedExit,
} from "../../../../../cli/commands/handover/currencyReadingRecord.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { CURRENCY_SCHEMA_VERSION, type CurrencyDocument } from "../../../../../handover/currency.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { lastReading } from "../../../../../readings/store.js";

const CHECKED = "2026-11-03T09:00:00.000Z";
const APPENDED = "2026-11-03T09:01:30.000Z";

const DOCUMENT: CurrencyDocument = {
  checkedIso: CHECKED,
  pullRequests: [],
  readFromIso: "2026-11-02T09:00:00.000Z",
  rows: [],
  said: {},
  schemaVersion: CURRENCY_SCHEMA_VERSION,
  sources: {
    chair: "0 turns read",
    github: "0 pull-request bodies read",
    memory: "0 memories read across 0 projects",
    profile: "no owner profile recorded",
    relays: "0 undelivered",
    rulings: "0 rulings read",
    voice: "none",
  },
};

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "currency-record-"));
  homes.push(home);
  return home;
}

describe("currencyReadingRecordInput", () => {
  it("files under the producer the console reads, observed at the document's checkedIso, appended at the clock given", () => {
    expect(
      currencyReadingRecordInput({ by: "sync-now", document: DOCUMENT, home: "/h", recordedAtIso: APPENDED }),
    ).toStrictEqual({
      by: "sync-now",
      document: JSON.stringify(DOCUMENT),
      home: "/h",
      nowIso: APPENDED,
      observedAtIso: CHECKED,
      producer: "handover currency",
    });
    expect(CURRENCY_PRODUCER).toBe("handover currency");
  });

  it("stores exactly the text --json prints", () => {
    const input = currencyReadingRecordInput({
      by: "sync-now",
      document: DOCUMENT,
      home: "/h",
      recordedAtIso: APPENDED,
    });
    expect(input.document).toBe(currencyDocumentText({ document: DOCUMENT }));
  });
});

describe("recordCurrencyReading", () => {
  it("appends a row reading last returns, by sync-now, with the document parsed back whole", () => {
    const home = freshHome();
    const input = currencyReadingRecordInput({ by: "sync-now", document: DOCUMENT, home, recordedAtIso: APPENDED });

    const receipt = unwrap(recordCurrencyReading({ input }));
    const last = unwrap(lastReading({ home, producer: "handover currency" }));

    expect(receipt.record.by).toBe("sync-now");
    expect(last.record.readingId).toBe(receipt.record.readingId);
    expect(last.record.observedAtIso).toBe(CHECKED);
    expect(last.record.recordedAtIso).toBe(APPENDED);
    expect(last.document).toStrictEqual(DOCUMENT);
  });

  it("refuses with the ledger's typed error when the readings directory is a file", () => {
    const home = freshHome();
    writeFileSync(join(home, "readings"), "not a directory");
    const input = currencyReadingRecordInput({ by: "sync-now", document: DOCUMENT, home, recordedAtIso: APPENDED });

    const recorded = recordCurrencyReading({ input });

    expect(unwrapErr(recorded).code).toBe("STORE_UNREADABLE");
  });
});

describe("currencyOutputOf and recordedExit", () => {
  it("records nothing and exits 0 when --record-reading was not given", () => {
    const home = freshHome();

    const output = currencyOutputOf({ document: DOCUMENT, home, recordReadingBy: undefined });

    expect(output).toStrictEqual({ recorded: undefined, text: JSON.stringify(DOCUMENT) });
    expect(recordedExit({ recorded: output.recorded })).toBe(EXIT_OK);
    expect(unwrapErr(lastReading({ home, producer: "handover currency" })).code).toBe("NO_READING");
  });

  it("exits 0 once the append landed, and 1 when the ledger refused it", () => {
    const landed = currencyOutputOf({ document: DOCUMENT, home: freshHome(), recordReadingBy: "sync-now" });
    const refusedHome = freshHome();
    writeFileSync(join(refusedHome, "readings"), "not a directory");
    const refused = currencyOutputOf({ document: DOCUMENT, home: refusedHome, recordReadingBy: "sync-now" });

    expect(landed.text).toBe(JSON.stringify(DOCUMENT));
    expect(refused.text).toBe(JSON.stringify(DOCUMENT));
    expect(recordedExit({ recorded: landed.recorded })).toBe(EXIT_OK);
    expect(recordedExit({ recorded: refused.recorded })).toBe(EXIT_ERROR);
  });
});
