import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { parseCardExport } from "../../../spend/parse.js";
import { cardReport } from "../../../spend/report.js";
import { exportText, FIXTURE_ROWS } from "./exportFixture.js";
import { FIXTURE_MERCHANTS } from "./merchantFixture.js";

const snapshotOf = ({ text }: { text: string }) =>
  unwrap(
    parseCardExport({ asOf: "2026-03-28", importedAt: "2026-03-28T01:00:00.000Z", sourcePath: "/tmp/card.md", text }),
  );

describe("cardReport", () => {
  it("computes the capture-day headroom as limit minus used", () => {
    const report = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text: exportText() }) });
    expect(report.monthly.headroom).toEqual({ currency: "AUD", minor: 10000 });
    expect(report.monthly.resetsOn).toBe("2026-03-31");
    expect(report.declineCount).toBe(4);
  });

  it("reports a negative headroom rather than clamping it", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 2,050.00 AUD of 2,000.00 AUD (102.5%), resets Mar 31" },
    });
    expect(cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text }) }).monthly.headroom).toEqual({
      currency: "AUD",
      minor: -5000,
    });
  });

  it("sets the latest declines against today's headroom AND the floor later charges prove", () => {
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText() }),
    }).latestDeclines!;
    expect(declines.date).toBe("2026-03-25");
    expect(declines.rows).toEqual([
      {
        amount: { currency: "AUD", minor: 12000 },
        exceedsHeadroomAsOf: "yes",
        identity: { kind: "merchant", slug: "openai" },
        merchant: "ChatGPT San Francisco",
        reason: null,
      },
      {
        amount: { currency: "AUD", minor: 12000 },
        exceedsHeadroomAsOf: "yes",
        identity: { kind: "merchant", slug: "openai" },
        merchant: "ChatGPT San Francisco",
        reason: null,
      },
    ]);
    expect(declines.chargedAfter).toEqual([
      { currency: "USD", minor: 1000 },
      { currency: "AUD", minor: 20000 },
    ]);
    // 100.00 headroom today + 200.00 AUD charged the day after; the 10.00 USD cannot be added without a rate.
    expect(declines.headroomThenAtLeast).toEqual({ currency: "AUD", minor: 30000 });
  });

  it("marks a decline in another currency as not comparable, and one within headroom as no", () => {
    const rows = ["| 2026-03-25 | OpenAI | 5.00 USD | Declined |", "| 2026-03-25 | OpenAI | 50.00 AUD | Declined |"];
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText({ rows }) }),
    }).latestDeclines!;
    expect(declines.rows.map((row) => row.exceedsHeadroomAsOf)).toEqual(["different-currency", "no"]);
    expect(declines.chargedAfter).toEqual([]);
    expect(declines.headroomThenAtLeast).toEqual({ currency: "AUD", minor: 10000 });
  });

  it("rules the limit out when every decline is under the floor, ignoring a zero-amount verification", () => {
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText() }),
    }).latestDeclines!;
    expect(declines.periodOpensAfter).toBe("2026-03-01");
    expect(declines.heldBefore).toEqual([]);
    expect(declines.limitVerdict).toEqual({ kind: "ruled-out" });
  });

  it("rules the limit out on today's headroom alone when nothing was charged after", () => {
    const rows = ["| 2026-03-25 | OpenAI | 50.00 AUD | Declined |"];
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText({ rows }) }),
    }).latestDeclines!;
    expect(declines.headroomThenAtLeast).toEqual({ currency: "AUD", minor: 10000 });
    expect(declines.limitVerdict).toEqual({ kind: "ruled-out" });
  });

  it("does not judge a decline that may sit in the period before the capture day's", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 10.00 AUD of 2,000.00 AUD (0.5%), resets Apr 30" },
      rows: ["| 2026-04-01 | Anthropic | 10.00 AUD | |", "| 2026-03-25 | ChatGPT | 155.00 AUD | Declined |"],
    });
    const snapshot = unwrap(
      parseCardExport({ asOf: "2026-04-02", importedAt: "2026-04-02T01:00:00.000Z", sourcePath: "/tmp/card.md", text }),
    );
    const declines = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot }).latestDeclines!;
    expect(declines.periodOpensAfter).toBe("2026-04-01");
    expect(declines.limitVerdict).toEqual({
      because: ["they may fall in the monthly period before the one the page's used figure covers"],
      kind: "possible",
    });
  });

  it("reads the previous reset as a month end too, so a January month-end decline is not judged against February", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 10.00 AUD of 2,000.00 AUD (0.5%), resets Feb 28" },
      rows: ["| 2026-02-05 | Anthropic | 100.00 AUD | |", "| 2026-01-31 | ChatGPT | 155.00 AUD | Declined |"],
    });
    const snapshot = unwrap(
      parseCardExport({ asOf: "2026-02-10", importedAt: "2026-02-10T01:00:00.000Z", sourcePath: "/tmp/card.md", text }),
    );
    const declines = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot }).latestDeclines!;
    expect(declines.periodOpensAfter).toBe("2026-02-01");
    expect(declines.limitVerdict.kind).toBe("possible");
  });

  it("subtracts a hold from the earliest day the period could have opened", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 1,000.00 AUD of 2,000.00 AUD (50.0%), resets Mar 31" },
      rows: ["| 2026-03-25 | ChatGPT | 155.00 AUD | Declined |", "| 2026-03-01 | Anthropic | 900.00 AUD | Cancelled |"],
    });
    const declines = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text }) }).latestDeclines!;
    expect(declines.heldBefore).toEqual([{ currency: "AUD", minor: 90000 }]);
    expect(declines.limitVerdict).toEqual({ because: ["that floor is below 1 of them"], kind: "possible" });
  });

  it("does not rule the limit out when one decline is in another currency", () => {
    const rows = [
      "| 2026-03-26 | Anthropic | 200.00 AUD | |",
      "| 2026-03-25 | OpenAI | 900.00 USD | Declined |",
      "| 2026-03-25 | ChatGPT | 50.00 AUD | Declined |",
    ];
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText({ rows }) }),
    }).latestDeclines!;
    expect(declines.limitVerdict).toEqual({
      because: ["1 of them cannot be set against a AUD limit without a rate"],
      kind: "possible",
    });
  });

  it("lowers the floor by a cancelled hold from before the declines", () => {
    const rows = [
      "| 2026-03-26 | Anthropic | 10.00 AUD | |",
      "| 2026-03-25 | ChatGPT | 155.00 AUD | Declined |",
      "| 2026-03-24 | Anthropic | 900.00 AUD | Cancelled |",
    ];
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 1,000.00 AUD of 2,000.00 AUD (50.0%), resets Mar 31" },
      rows,
    });
    const declines = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text }) }).latestDeclines!;
    expect(declines.heldBefore).toEqual([{ currency: "AUD", minor: 90000 }]);
    expect(declines.headroomThenAtLeast).toEqual({ currency: "AUD", minor: 11000 });
    expect(declines.limitVerdict).toEqual({ because: ["that floor is below 1 of them"], kind: "possible" });
  });

  it("does not rule the limit out past a hold in another currency", () => {
    const rows = [
      "| 2026-03-25 | ChatGPT | 50.00 AUD | Declined |",
      "| 2026-03-24 | OpenAI | 5.00 USD | Card verification |",
    ];
    const declines = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText({ rows }) }),
    }).latestDeclines!;
    expect(declines.limitVerdict).toEqual({
      because: ["an earlier hold in USD lowered the headroom by an amount the page cannot price"],
      kind: "possible",
    });
  });

  it("answers null when the page shows no decline", () => {
    const rows = FIXTURE_ROWS.filter((row) => !row.includes("Declined"));
    const report = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text: exportText({ rows }) }) });
    expect(report.latestDeclines).toBeNull();
    expect(report.declineCount).toBe(0);
  });

  it("totals only charged rows per registered merchant, keeping currencies apart", () => {
    const report = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text: exportText() }) });
    expect(report.byMerchant).toEqual([
      {
        charges: 2,
        identity: { kind: "merchant", slug: "anthropic" },
        merchants: ["Anthropic"],
        totals: [{ currency: "AUD", minor: 135000 }],
      },
      {
        charges: 2,
        identity: { kind: "merchant", slug: "openai" },
        merchants: ["OpenAI"],
        totals: [
          { currency: "AUD", minor: 12000 },
          { currency: "USD", minor: 1000 },
        ],
      },
    ]);
  });

  it("gives each unregistered merchant its own group, after every registered one", () => {
    const rows = [
      "| 2026-03-01 | Some Other SaaS | 9.00 AUD | |",
      "| 2026-03-01 | Another Tool | 2.00 AUD | |",
      "| 2026-03-01 | Anthropic | 1.00 AUD | |",
    ];
    const byMerchant = cardReport({
      merchants: FIXTURE_MERCHANTS,
      snapshot: snapshotOf({ text: exportText({ rows }) }),
    }).byMerchant;
    expect(byMerchant.map((row) => row.identity)).toEqual([
      { kind: "merchant", slug: "anthropic" },
      { kind: "raw", merchant: "Another Tool" },
      { kind: "raw", merchant: "Some Other SaaS" },
    ]);
  });

  it("groups every charge by its own merchant string when the install registers none", () => {
    const rows = ["| 2026-03-01 | OpenAI | 9.00 AUD | |", "| 2026-03-02 | ChatGPT | 1.00 AUD | |"];
    const byMerchant = cardReport({ merchants: [], snapshot: snapshotOf({ text: exportText({ rows }) }) }).byMerchant;
    expect(byMerchant).toEqual([
      {
        charges: 1,
        identity: { kind: "raw", merchant: "ChatGPT" },
        merchants: ["ChatGPT"],
        totals: [{ currency: "AUD", minor: 100 }],
      },
      {
        charges: 1,
        identity: { kind: "raw", merchant: "OpenAI" },
        merchants: ["OpenAI"],
        totals: [{ currency: "AUD", minor: 900 }],
      },
    ]);
  });

  it("never merges a registered slug with a raw merchant string of the same text", () => {
    const rows = ["| 2026-03-01 | acme | 9.00 AUD | |", "| 2026-03-01 | Other Shop | 1.00 AUD | |"];
    const merchants = [{ prefixes: ["other shop"], receiptDomains: [], slug: "acme" }];
    const byMerchant = cardReport({ merchants, snapshot: snapshotOf({ text: exportText({ rows }) }) }).byMerchant;
    expect(byMerchant.map((row) => row.identity)).toEqual([
      { kind: "merchant", slug: "acme" },
      { kind: "raw", merchant: "acme" },
    ]);
  });

  it("totals charged rows per month and merchant, oldest month first", () => {
    const report = cardReport({ merchants: FIXTURE_MERCHANTS, snapshot: snapshotOf({ text: exportText() }) });
    expect(report.byMonth).toEqual([
      {
        identity: { kind: "merchant", slug: "anthropic" },
        month: "2026-02",
        totals: [{ currency: "AUD", minor: 115000 }],
      },
      {
        identity: { kind: "merchant", slug: "anthropic" },
        month: "2026-03",
        totals: [{ currency: "AUD", minor: 20000 }],
      },
      {
        identity: { kind: "merchant", slug: "openai" },
        month: "2026-03",
        totals: [
          { currency: "AUD", minor: 12000 },
          { currency: "USD", minor: 1000 },
        ],
      },
    ]);
  });
});
