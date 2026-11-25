/*
 * The Store page's table-name box as a pure projection: an empty box keeps every table unmarked, a typed name keeps
 * the tables whose name holds it ignoring case, literally, untrimmed, in the document's order, and splits out the
 * matched span in the name's own casing. Synthetic `acme` names only.
 */
import { describe, expect, it } from "vitest";

import { utf8Hex } from "../../lib/slots";
import type { StoreTableDefinition } from "../../lib/storeDocuments";
import { matchingStoreTables, storeTableCountWords } from "../../lib/storeTableNames";

/**
 * A table with no columns, named and tokened the way `store tables` prints one.
 *
 * @returns the table
 */
function table({ name }: { name: string }): StoreTableDefinition {
  return { columns: [], estimatedRows: null, name, primaryKey: [], token: utf8Hex({ text: name }) };
}

const TABLES = [
  table({ name: "acme_orders" }),
  table({ name: "Acme_Notes" }),
  table({ name: "board_row" }),
  table({ name: "acme order lines" }),
  table({ name: "price(usd)" }),
];

describe("matchingStoreTables", () => {
  it("keeps every table, in order and unmarked, while the box is empty", () => {
    expect(matchingStoreTables({ query: "", tables: TABLES })).toEqual(
      TABLES.map((one) => ({ name: null, table: one })),
    );
  });

  it("keeps the names holding the query ignoring case, splitting out the match in the name's own casing", () => {
    expect(matchingStoreTables({ query: "ACME", tables: TABLES }).map((one) => one.name)).toEqual([
      { after: "_orders", before: "", match: "acme" },
      { after: "_Notes", before: "", match: "Acme" },
      { after: " order lines", before: "", match: "acme" },
    ]);
  });

  it("drops the tables that do not match and keeps the document's order", () => {
    expect(matchingStoreTables({ query: "o", tables: TABLES }).map((one) => one.table.name)).toEqual([
      "acme_orders",
      "Acme_Notes",
      "board_row",
      "acme order lines",
    ]);
  });

  it("reads a query with pattern characters literally", () => {
    expect(matchingStoreTables({ query: "(usd)", tables: TABLES }).map((one) => one.name)).toEqual([
      { after: "", before: "price", match: "(usd)" },
    ]);
    expect(matchingStoreTables({ query: ".*", tables: TABLES })).toEqual([]);
  });

  it("does not trim the query, since a space is part of a name", () => {
    expect(matchingStoreTables({ query: " order", tables: TABLES }).map((one) => one.table.name)).toEqual([
      "acme order lines",
    ]);
  });

  it("matches a letter whose lowercase is longer than it, and marks the whole letter in the name", () => {
    const dotted = String.fromCodePoint(0x130);
    const tables = [table({ name: `acme_${dotted}d` }), table({ name: "acme_id" })];
    expect(matchingStoreTables({ query: dotted.toLowerCase(), tables }).map((one) => one.name)).toEqual([
      { after: "d", before: "acme_", match: dotted },
    ]);
    expect(matchingStoreTables({ query: dotted, tables }).map((one) => one.table.name)).toEqual([`acme_${dotted}d`]);
  });

  it("folds a query and a name alike whatever surrounds a letter", () => {
    // Whole-string lowercasing folds this sigma to a medial form inside the name and a final form ending the query.
    const sigma = String.fromCodePoint(0x3a3);
    expect(`acme${sigma}`.toLowerCase()).not.toBe(`acme${sigma}log`.toLowerCase().slice(0, 5));
    const tables = [table({ name: `acme${sigma}log` })];
    expect(matchingStoreTables({ query: `acme${sigma}`, tables }).map((one) => one.name)).toEqual([
      { after: "log", before: "", match: `acme${sigma}` },
    ]);
  });

  it("meets every case form of a letter: final sigma with capital sigma, sharp s with ss", () => {
    const finalSigma = String.fromCodePoint(0x3c2);
    const capitalSigma = String.fromCodePoint(0x3a3);
    const sharpS = String.fromCodePoint(0xdf);
    const tables = [table({ name: `acme${finalSigma}` }), table({ name: `stra${sharpS}e` })];
    expect(matchingStoreTables({ query: capitalSigma, tables }).map((one) => one.name)).toEqual([
      { after: "", before: "acme", match: finalSigma },
    ]);
    expect(matchingStoreTables({ query: "SS", tables }).map((one) => one.name)).toEqual([
      { after: "e", before: "stra", match: sharpS },
    ]);
  });

  it("keeps nothing when no name matches", () => {
    expect(matchingStoreTables({ query: "zzz", tables: TABLES })).toEqual([]);
  });
});

describe("storeTableCountWords", () => {
  it("names the whole count while the box is empty", () => {
    expect(storeTableCountWords({ kept: 5, query: "", total: 5 })).toBe("5 tables");
  });

  it("names how many the box keeps of the whole once it holds anything, a space included", () => {
    expect(storeTableCountWords({ kept: 3, query: "acme", total: 5 })).toBe("3 of 5 tables");
    expect(storeTableCountWords({ kept: 0, query: " ", total: 5 })).toBe("0 of 5 tables");
  });
});
