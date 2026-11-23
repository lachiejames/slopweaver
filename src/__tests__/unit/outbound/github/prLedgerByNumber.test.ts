/**
 * The PR ledger read by number: keyed on the repository AND the number, since the personal remote's numbers collide
 * with origin's; two records on one number are ambiguous rather than one picked; a form that will not decode is
 * said, never read as absent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ledgerDir } from "../../../../outbound/github/prLedger.js";
import {
  indexLedgerByNumber,
  ledgerFormOf,
  type PrLedgerRead,
  rawRecordOf,
  readPrRecordsFor,
} from "../../../../outbound/github/prLedgerByNumber.js";
import { FEATURE_BODY, formOf } from "./fixtures.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const FORM = formOf({ body: FEATURE_BODY });

describe("indexLedgerByNumber", () => {
  it("matches the repository case-insensitively and ignores another repository's same number", () => {
    const hits = indexLedgerByNumber({
      numbers: new Set([7]),
      records: [
        { form: undefined, locus: "LachieJames/slopweaver#main...mine", number: 7 },
        { form: undefined, locus: "slopweaver/slopweaver#main...theirs", number: 7 },
      ],
      repo: "lachiejames/slopweaver",
    });
    expect([...hits.entries()]).toEqual([
      [7, { form: { kind: "absent" }, kind: "one", locus: "LachieJames/slopweaver#main...mine" }],
    ]);
  });

  it("reports two records on one number as ambiguous, with the count", () => {
    const hits = indexLedgerByNumber({
      numbers: new Set([7]),
      records: [
        { form: undefined, locus: "o/r#main...a", number: 7 },
        { form: undefined, locus: "o/r#main...b", number: 7 },
      ],
      repo: "o/r",
    });
    expect(hits.get(7)).toEqual({ count: 2, kind: "ambiguous" });
  });

  it("holds nothing for a number nobody asked for", () => {
    const hits = indexLedgerByNumber({
      numbers: new Set([8]),
      records: [{ form: undefined, locus: "o/r#main...a", number: 7 }],
      repo: "o/r",
    });
    expect(hits.size).toBe(0);
  });
});

describe("ledgerFormOf", () => {
  it("decodes a stored form exactly", () => {
    expect(ledgerFormOf({ form: JSON.parse(JSON.stringify(FORM)) })).toEqual({ form: FORM, kind: "decoded" });
  });

  it("says where a stored form stopped decoding", () => {
    const read = ledgerFormOf({ form: { grade: "not a form" } });
    expect(read.kind).toBe("undecodable");
    expect(JSON.stringify(read)).toContain("the stored form does not decode at");
  });
});

describe("readPrRecordsFor", () => {
  it("reads every record file, names each one that would not read, and passes a numberless reservation", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-prbynumber-"));
    fixtureDirs.push(home);
    const dir = ledgerDir({ home });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.json"), JSON.stringify({ form: FORM, locus: "o/r#main...x", number: 7 }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ locus: "o/r#main...y", number: "7" }));
    writeFileSync(join(dir, "c.txt"), JSON.stringify({ locus: "o/r#main...y", number: 7 }));
    writeFileSync(join(dir, "d.json"), JSON.stringify({ locus: "o/r#main...z", reservedIso: "2026-10-05T00:00:00Z" }));
    const expected: PrLedgerRead = {
      hits: new Map([[7, { form: { form: FORM, kind: "decoded" }, kind: "one", locus: "o/r#main...x" }]]),
      kind: "read",
      unread: [{ file: "b.json", why: "its number is not a number (o/r#main...y)" }],
    };
    expect(readPrRecordsFor({ home, numbers: new Set([7]), repo: "o/r" })).toEqual(expected);
  });

  it("reads a home with no ledger as an empty one", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-prbynumber-"));
    fixtureDirs.push(home);
    expect(readPrRecordsFor({ home, numbers: new Set([7]), repo: "o/r" })).toEqual({
      hits: new Map(),
      kind: "read",
      unread: [],
    });
  });

  it("says a ledger path that will not list is unreadable, never empty", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-prbynumber-"));
    fixtureDirs.push(home);
    const dir = ledgerDir({ home });
    mkdirSync(join(dir, ".."), { recursive: true });
    writeFileSync(dir, "a file where the directory should be");
    const read = readPrRecordsFor({ home, numbers: new Set([7]), repo: "o/r" });
    expect(read.kind).toBe("unreadable");
    expect(JSON.stringify(read)).toContain("ENOTDIR");
  });
});

describe("rawRecordOf", () => {
  it("names why a file is not a record", () => {
    expect(rawRecordOf({ raw: "[]" })).toEqual({ kind: "unread", why: "not a JSON object" });
    expect(rawRecordOf({ raw: JSON.stringify({ number: 7 }) })).toEqual({ kind: "unread", why: "carries no locus" });
    expect(rawRecordOf({ raw: "nope" }).kind).toBe("unread");
  });
});
