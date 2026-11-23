// The vendor table left the code for the install's register; `spend/merchants/core.test.ts` holds its matching down.
// deleted-with-code: vendorOf
import { describe, expect, it } from "vitest";

import { formatMoney, parseMoney, sumByCurrency } from "../../../spend/money.js";

describe("parseMoney", () => {
  it.each([
    ["2,410.58 AUD", { currency: "AUD", minor: 241058 }],
    ["1,000,000.01 AUD", { currency: "AUD", minor: 100000001 }],
    ["22.00 USD", { currency: "USD", minor: 2200 }],
    ["0.00 USD", { currency: "USD", minor: 0 }],
  ])("reads %s exactly", (text, expected) => {
    expect(parseMoney({ text })).toEqual(expected);
  });

  it.each(["12.5 AUD", "12.500 AUD", "12.50", "12.50 aud", "1,23.00 AUD", "$12.50"])("refuses %s", (text) => {
    expect(parseMoney({ text })).toBeUndefined();
  });
});

describe("formatMoney", () => {
  it("prints grouped whole units and two decimals", () => {
    expect(formatMoney({ money: { currency: "AUD", minor: 241058 } })).toBe("2,410.58 AUD");
  });

  it("prints a negative amount with its sign", () => {
    expect(formatMoney({ money: { currency: "AUD", minor: -505 } })).toBe("-5.05 AUD");
  });
});

describe("sumByCurrency", () => {
  it("totals each currency apart, sorted by code", () => {
    const amounts = [
      { currency: "USD", minor: 100 },
      { currency: "AUD", minor: 250 },
      { currency: "USD", minor: 5 },
    ];
    expect(sumByCurrency({ amounts })).toEqual([
      { currency: "AUD", minor: 250 },
      { currency: "USD", minor: 105 },
    ]);
  });

  it("answers no totals for no amounts", () => {
    expect(sumByCurrency({ amounts: [] })).toEqual([]);
  });
});
