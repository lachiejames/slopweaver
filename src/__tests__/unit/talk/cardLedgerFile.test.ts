/*
 * The shape both card ledgers share: a missing file reads empty, a line that is not a row is COUNTED by its 1-based
 * number rather than dropped, a row that would not read back is refused before any write, and an append lands the
 * file `0600` in a `0700` directory.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  appendCardLedgerRow,
  type CardLedgerUnreadableLine,
  readCardLedger,
  refusedCardLedgerRow,
  unreadableCardLinesForKeys,
  unreadableCardLinesOfAnyCard,
  unreadableCardLinesSince,
} from "../../../talk/cardLedgerFile.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-card-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A row is an object carrying a string `key`; anything else is not one. */
function keyRowOf({ value }: { value: unknown }): { key: string } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row: Record<string, unknown> = { ...value };
  return typeof row["key"] === "string" ? { key: row["key"] } : undefined;
}

const ledger = (): string => join(home, "talk", "ledger.jsonl");

describe("readCardLedger", () => {
  it("reads a file that is not there as an empty ledger", () => {
    const read = unwrap(readCardLedger({ label: "row", parse: keyRowOf, path: ledger() }));
    expect(read.rows).toEqual([]);
    expect(read.unreadable).toEqual([]);
  });

  it("keeps every row in file order and counts each line that is not one, skipping blank lines", () => {
    mkdirSync(join(home, "talk"));
    appendFileSync(ledger(), '{"key":"a"}\nnot json\n\n{"other":1}\n{"key":"b"}\n');
    const read = unwrap(readCardLedger({ label: "row", parse: keyRowOf, path: ledger() }));
    expect(read.rows).toEqual([{ key: "a" }, { key: "b" }]);
    expect(read.unreadable).toEqual([2, 4]);
  });

  it("describes each refused line by the card key and instant it recorded, verbatim, and nothing else", () => {
    mkdirSync(join(home, "talk"));
    appendFileSync(
      ledger(),
      [
        '{"key":"a","cardKey":"ask:read-fine"}',
        '{"cardKey":"ask:acme-Fixture 1-seats","atIso":"2026-11-08T09:28:17.485Z"}',
        "not json",
        '{"cardKey":7,"atIso":false}',
        '["ask:acme"]',
        "",
        '{"cardKey":"ask:acme-fixture"}',
      ].join("\n"),
    );
    const read = unwrap(readCardLedger({ label: "row", parse: keyRowOf, path: ledger() }));
    expect(read.unreadable).toEqual([2, 3, 4, 5, 7]);
    expect(read.unreadableLines).toEqual([
      { atIso: "2026-11-08T09:28:17.485Z", cardKey: "ask:acme-Fixture 1-seats", lineNumber: 2 },
      { atIso: undefined, cardKey: undefined, lineNumber: 3 },
      { atIso: undefined, cardKey: undefined, lineNumber: 4 },
      { atIso: undefined, cardKey: undefined, lineNumber: 5 },
      { atIso: undefined, cardKey: "ask:acme-fixture", lineNumber: 7 },
    ]);
  });

  it("reads a file that is not there with no refused lines described", () => {
    expect(unwrap(readCardLedger({ label: "row", parse: keyRowOf, path: ledger() })).unreadableLines).toEqual([]);
  });
});

/** One refused line, described. */
const refused = ({
  lineNumber,
  cardKey,
  atIso,
}: {
  lineNumber: number;
  cardKey?: string;
  atIso?: string;
}): CardLedgerUnreadableLine => ({ atIso, cardKey, lineNumber });

describe("unreadableCardLinesForKeys", () => {
  const lines = [
    refused({ lineNumber: 1 }),
    refused({ cardKey: "ask:acme-Fixture 1-seats", lineNumber: 2 }),
    refused({ cardKey: "ask:abc-1", lineNumber: 3 }),
    refused({ cardKey: "ask:abc-2", lineNumber: 4 }),
  ];

  it("keeps a line naming no key and a line naming a card read, never a key that is no card key", () => {
    const kept = unreadableCardLinesForKeys({ cardKeys: new Set(["ask:abc-1"]), lines });
    expect(kept.map((line) => line.lineNumber)).toEqual([1, 3]);
  });

  // The sanitiser's own damaged key, read by its exact spelling, still names no card a surface can draw.
  it("never keeps a key that is no card key, even when the surface asks for that exact spelling", () => {
    const kept = unreadableCardLinesForKeys({ cardKeys: new Set(["ask:acme-Fixture 1-seats"]), lines });
    expect(kept.map((line) => line.lineNumber)).toEqual([1]);
  });

  it("keeps only the lines naming no key when the surface reads no card", () => {
    expect(unreadableCardLinesForKeys({ cardKeys: new Set(), lines }).map((line) => line.lineNumber)).toEqual([1]);
  });
});

describe("unreadableCardLinesOfAnyCard", () => {
  it("keeps a line naming no key and every real card key, dropping only a key that is no card key", () => {
    const lines = [
      refused({ lineNumber: 1 }),
      refused({ cardKey: "ask:acme-Fixture 1-seats", lineNumber: 2 }),
      refused({ cardKey: "post:abc-1", lineNumber: 3 }),
    ];
    expect(unreadableCardLinesOfAnyCard({ lines }).map((line) => line.lineNumber)).toEqual([1, 3]);
  });
});

describe("unreadableCardLinesSince", () => {
  const sinceIso = "2026-11-17T12:00:00.000Z";

  it("drops a real key written before the floor and a key that is no card key, keeping every other line", () => {
    const lines = [
      refused({ lineNumber: 1 }),
      refused({ atIso: "2026-11-17T11:59:59.999Z", cardKey: "ask:abc-1", lineNumber: 2 }),
      refused({ atIso: "2026-11-17T12:00:00.000Z", cardKey: "ask:abc-2", lineNumber: 3 }),
      refused({ atIso: "2026-11-20T00:00:00.000Z", cardKey: "ask:abc-3", lineNumber: 4 }),
      refused({ atIso: "not an instant", cardKey: "ask:abc-4", lineNumber: 5 }),
      refused({ cardKey: "ask:abc-5", lineNumber: 6 }),
      refused({ atIso: "2026-11-18T00:00:00.000Z", cardKey: "ask:acme-Fixture 1-seats", lineNumber: 7 }),
    ];
    expect(unreadableCardLinesSince({ lines, sinceIso }).map((line) => line.lineNumber)).toEqual([1, 3, 4, 5, 6]);
  });
});

describe("refusedCardLedgerRow", () => {
  it("takes a row that reads back", () => {
    expect(refusedCardLedgerRow({ label: "row", parse: keyRowOf, path: ledger(), row: { key: "a" } })).toBe(undefined);
  });

  it("refuses a row its own parser would not read back, naming the ledger", () => {
    const refusal = refusedCardLedgerRow({ label: "row", parse: () => undefined, path: ledger(), row: { key: "a" } })!;
    expect(refusal.code).toBe("LEDGER_IO");
    expect(refusal.message).toContain("ledger.jsonl");
  });
});

describe("appendCardLedgerRow", () => {
  it("appends one line a read gives back, the file 0600 in a 0700 directory", () => {
    expect(existsSync(ledger())).toBe(false);
    expect(unwrap(appendCardLedgerRow({ label: "row", parse: keyRowOf, path: ledger(), row: { key: "a" } }))).toBe(
      ledger(),
    );
    unwrap(appendCardLedgerRow({ label: "row", parse: keyRowOf, path: ledger(), row: { key: "b" } }));
    expect(unwrap(readCardLedger({ label: "row", parse: keyRowOf, path: ledger() })).rows).toEqual([
      { key: "a" },
      { key: "b" },
    ]);
    expect(statSync(ledger()).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "talk")).mode & 0o777).toBe(0o700);
  });

  // The line checked is the line written, so a row serialising differently on a second call cannot
  // slip an unreadable line past the check.
  it("checks the exact line it writes, refusing a row whose second serialisation would not read back", () => {
    let calls = 0;
    const shifty = {
      key: "a",
      toJSON: (): unknown => {
        calls += 1;
        return calls === 1 ? { other: 1 } : { key: "a" };
      },
    };
    // The parser answers the row itself for any line it reads as a row, so the row type stays the shifty one.
    const parse = ({ value }: { value: unknown }): typeof shifty | undefined =>
      keyRowOf({ value }) === undefined ? undefined : shifty;
    const refusal = unwrapErr(appendCardLedgerRow({ label: "row", parse, path: ledger(), row: shifty }));
    expect(refusal.code).toBe("LEDGER_IO");
    expect(calls).toBe(1);
    expect(existsSync(ledger())).toBe(false);
  });
});
