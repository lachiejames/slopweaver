import { describe, expect, it } from "vitest";

import { checkAmounts, dayOf, minorOf, transactionsOf } from "../../../spend/liveRows.js";
import type { CardTransaction } from "../../../spend/types.js";
import { MERCHANT, STORED_DECLINE, ZONE } from "./liveFixture.js";

describe("minorOf", () => {
  it("scales a major amount to whole minor units", () => {
    const problems: string[] = [];
    expect(minorOf({ amount: 155.5, problems, scale: 100 })).toBe(15550);
    expect(problems).toEqual([]);
  });

  it("records an amount that is no whole number of minor units", () => {
    const problems: string[] = [];
    expect(minorOf({ amount: 1.234, problems, scale: 100 })).toBe(123);
    expect(problems).toEqual(["an amount is not a whole number of minor units at the calibrated scale"]);
  });
});

describe("dayOf", () => {
  it("keeps a day, and reads an instant with an offset in the page's zone", () => {
    expect(dayOf({ text: "2026-09-25", timeZone: ZONE })).toBe("2026-09-25");
    expect(dayOf({ text: "2026-09-24T15:30:00+00:00", timeZone: ZONE })).toBe("2026-09-25");
  });

  it("reads an instant with no offset, or no date at all, as nothing", () => {
    expect(dayOf({ text: "2026-09-24T15:30:00", timeZone: ZONE })).toBe(null);
    expect(dayOf({ text: "25/09/2026", timeZone: ZONE })).toBe(null);
  });
});

describe("transactionsOf", () => {
  it("carries no decline reason on a row the backend gave none", () => {
    const problems: string[] = [];
    const rows = transactionsOf({
      problems,
      rows: [
        {
          cardId: "card",
          date: "2026-09-25",
          failureReason: null,
          id: "t1",
          merchantDetails: { cleanMerchantName: MERCHANT },
          status: "DECLINED",
          transactionAmount: 155,
          transactionCurrency: "AUD",
        },
      ],
      scale: 100,
      timeZone: ZONE,
    });
    expect(rows).toEqual([
      {
        amount: { currency: "AUD", minor: 15500 },
        date: "2026-09-25",
        merchant: MERCHANT,
        ordinal: 0,
        status: "declined",
      },
    ]);
    expect(problems).toEqual([]);
  });
});

describe("checkAmounts", () => {
  it("passes a live row matching any of the stored amounts on its day", () => {
    const problems: string[] = [];
    const other: CardTransaction = { ...STORED_DECLINE, amount: { currency: "AUD", minor: 4200 }, ordinal: 1 };
    checkAmounts({ problems, stored: [STORED_DECLINE, other], transactions: [other] });
    expect(problems).toEqual([]);
  });

  it("passes an empty live page, which carries no unit to check", () => {
    const problems: string[] = [];
    checkAmounts({ problems, stored: [STORED_DECLINE], transactions: [] });
    expect(problems).toEqual([]);
  });
});
