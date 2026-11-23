import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { isIsoDay } from "../../../spend/exportLines.js";
import { parseCardExport, resolveResetDay } from "../../../spend/parse.js";
import { exportText } from "./exportFixture.js";

const parse = ({ text, asOf = "2026-03-28" }: { text: string; asOf?: string }) =>
  parseCardExport({ asOf, importedAt: "2026-03-28T01:00:00.000Z", sourcePath: "/tmp/card.md", text });

describe("parseCardExport", () => {
  it("reads every field of a whole export", () => {
    const snapshot = unwrap(parse({ text: exportText() }));
    expect(snapshot.organisation).toBe("EXAMPLE TRADING PTY LTD");
    expect(snapshot.nickname).toBe("Subs | AI | Test");
    expect(snapshot.last4).toBe("0042");
    expect(snapshot.provider).toBe("airwallex");
    expect(snapshot.merchantAllow).toEqual(["Anthropic", "OpenAI", "ChatGPT"]);
    expect(snapshot.monthly).toEqual({
      limit: { currency: "AUD", minor: 200000 },
      resetNote: "reset at 10:00 AM UTC+10 the following day",
      resetsOn: "2026-03-31",
      used: { currency: "AUD", minor: 190000 },
    });
    expect(snapshot.transactionLimit).toEqual({ currency: "AUD", minor: 50000 });
    expect(snapshot.transactions).toHaveLength(10);
    expect(snapshot.transactions[0]).toEqual({
      amount: { currency: "USD", minor: 1000 },
      date: "2026-03-26",
      merchant: "OpenAI",
      ordinal: 0,
      status: "charged",
    });
    expect(snapshot.transactions.map((row) => row.status)).toEqual([
      "charged",
      "charged",
      "declined",
      "declined",
      "charged",
      "card-verification",
      "declined",
      "cancelled",
      "charged",
      "declined",
    ]);
    expect(snapshot.transactions[8]!.amount).toEqual({ currency: "AUD", minor: 115000 });
    expect(snapshot.source).toEqual({ importedAt: "2026-03-28T01:00:00.000Z", kind: "pasted", path: "/tmp/card.md" });
  });

  it("accepts a table with no rows", () => {
    expect(unwrap(parse({ text: exportText({ rows: [] }) })).transactions).toEqual([]);
  });

  it("holds a card with no merchant control as null", () => {
    expect(unwrap(parse({ text: exportText({ replace: { "Merchant control:": null } }) })).merchantAllow).toBeNull();
  });

  it.each([
    ["Organisation:", "Organisation"],
    ["Card:", "Card"],
    ["Limits", "Limits"],
    ["- Monthly:", "Monthly limit"],
    ["- Transaction limit:", "Transaction limit"],
    ["| Date |", "transaction table header | Date | Merchant | Amount | Status |"],
  ])("refuses an export missing its %s line by name", (prefix, line) => {
    const error = unwrapErr(parse({ text: exportText({ replace: { [prefix]: null } }) }));
    expect(error.code).toBe("EXPORT_LINE_MISSING");
    expect(error.message).toContain(line);
  });

  it("refuses a Card line pasted twice", () => {
    const text = exportText({ replace: { "Card:": 'Card: "A", ending 0042\nCard: "B", ending 0043' } });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("it appears twice");
  });

  it("refuses a Card line carrying no last four digits", () => {
    const error = unwrapErr(parse({ text: exportText({ replace: { "Card:": 'Card: "A", company card' } }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("the Card line");
  });

  it("refuses an amount without exactly two decimals, naming its line", () => {
    const error = unwrapErr(parse({ text: exportText({ rows: ["| 2026-03-01 | OpenAI | 12.5 AUD | |"] }) }));
    expect(error.code).toBe("AMOUNT_UNPARSEABLE");
    expect(error.message).toContain("line 15");
  });

  it("refuses a status the page is not known to print", () => {
    const error = unwrapErr(parse({ text: exportText({ rows: ["| 2026-03-01 | OpenAI | 12.50 AUD | Pending |"] }) }));
    expect(error.code).toBe("STATUS_UNKNOWN");
    expect(error.message).toContain('"Pending"');
  });

  it("refuses a day that does not exist", () => {
    const error = unwrapErr(parse({ text: exportText({ rows: ["| 2026-02-30 | OpenAI | 12.50 AUD | |"] }) }));
    expect(error.code).toBe("DATE_INVALID");
    expect(error.message).toContain("2026-02-30");
  });

  it("refuses a table row that is not four cells", () => {
    const error = unwrapErr(parse({ text: exportText({ rows: ["| 2026-03-01 | OpenAI | 12.50 AUD |"] }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("transaction row");
  });

  it("refuses a table whose separator row is missing, rather than dropping its first row", () => {
    const error = unwrapErr(parse({ text: exportText({ replace: { "|---|": null } }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("table separator");
  });

  it("refuses a table row after a blank line, rather than truncating the table", () => {
    const rows = ["| 2026-03-26 | OpenAI | 10.00 AUD | |", "", "| 2026-03-27 | OpenAI | 10.00 AUD | Declined |"];
    const error = unwrapErr(parse({ text: exportText({ rows }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("line 17: the transaction row after the table ended line");
  });

  it("holds the table to the row count its heading states", () => {
    const text = exportText({ replace: { "## Transactions": "## Transactions (9 rows, newest first)" } });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("ROW_COUNT_MISMATCH");
    expect(error.message).toContain("says 9 row(s) but the table holds 10");
    const matching = exportText({ replace: { "## Transactions": "## Transactions (10 rows, newest first)" } });
    expect(unwrap(parse({ text: matching })).transactions).toHaveLength(10);
  });

  it("refuses a row dated after the capture day", () => {
    const error = unwrapErr(parse({ asOf: "2026-03-25", text: exportText() }));
    expect(error.code).toBe("ROW_AFTER_CAPTURE");
    expect(error.message).toContain("dated 2026-03-26 is after the capture day 2026-03-25");
  });

  it("refuses a row with an empty merchant", () => {
    const error = unwrapErr(parse({ text: exportText({ rows: ["| 2026-03-01 |  | 12.50 AUD | |"] }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("transaction row");
  });

  it("refuses a second Merchant control line", () => {
    const text = exportText({
      replace: { "Merchant control:": "Merchant control: Allow Anthropic.\nMerchant control: Allow OpenAI." },
    });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("it appears twice");
  });

  it("keeps a merchant with a full stop inside its name on the allow list", () => {
    const text = exportText({
      replace: {
        "Merchant control:": "Merchant control: Allow Anthropic, OpenAI Inc., ChatGPT. Transaction types: 2.",
      },
    });
    expect(unwrap(parse({ text })).merchantAllow).toEqual(["Anthropic", "OpenAI Inc.", "ChatGPT"]);
  });

  it("keeps a merchant whose name has a full stop and a space in it", () => {
    const text = exportText({
      replace: { "Merchant control:": "Merchant control: Allow Anthropic Pty. Ltd, OpenAI, ChatGPT." },
    });
    expect(unwrap(parse({ text })).merchantAllow).toEqual(["Anthropic Pty. Ltd", "OpenAI", "ChatGPT"]);
  });

  it("refuses a last row that lost its leading pipe, rather than dropping it", () => {
    const rows = ["| 2026-03-26 | Anthropic | 200.00 AUD | |", "2026-03-25 | ChatGPT | 155.00 AUD | Declined |"];
    const error = unwrapErr(parse({ text: exportText({ rows }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("line 16: the table's closing blank line");
  });

  it("refuses a pipe-less row further down, after the blank line", () => {
    const text = exportText({ replace: { "Free prose": "2026-03-25 | ChatGPT | 155.00 AUD | Declined |" } });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("transaction row after the table ended");
  });

  it("reads the row count only from the heading directly above the table", () => {
    const text = exportText({ replace: { "# Card export": "# Card export\n## Transactions (1 row, last month)" } });
    expect(unwrap(parse({ text })).transactions).toHaveLength(10);
  });

  it("refuses a Limits line that is not the heading", () => {
    const error = unwrapErr(parse({ text: exportText({ replace: { Limits: "Limitsless prose" } }) }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("the Limits line");
  });

  it("refuses a Monthly line above the Limits heading", () => {
    const text = exportText({
      replace: {
        "Organisation:": "Organisation: EXAMPLE TRADING PTY LTD\n- Monthly: 1.00 AUD of 2.00 AUD (50%), resets Mar 31",
        "- Monthly:": null,
      },
    });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("it sits outside the block under the Limits heading");
  });

  it("refuses a Monthly line elsewhere below the Limits block", () => {
    const text = exportText({
      replace: {
        "- Monthly:": null,
        "Free prose": "- Monthly: 1.00 AUD of 2.00 AUD (50%), resets Mar 31",
      },
    });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("it sits outside the block under the Limits heading");
  });

  it("refuses a Card line naming two last-four digits", () => {
    const error = unwrapErr(
      parse({ text: exportText({ replace: { "Card:": 'Card: "A", ending 0042, was ending 0043' } }) }),
    );
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("the Card line");
  });

  it("refuses limits in more than one currency", () => {
    const text = exportText({ replace: { "- Transaction limit:": "- Transaction limit: 500.00 USD" } });
    const error = unwrapErr(parse({ text }));
    expect(error.code).toBe("LIMIT_CURRENCY_MISMATCH");
    expect(error.message).toContain("AUD, USD");
  });

  it("resolves a reset month earlier than the capture day into the next year", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 10.00 AUD of 2,000.00 AUD (0.5%), resets Jan 2" },
    });
    expect(unwrap(parse({ asOf: "2026-12-30", text })).monthly.resetsOn).toBe("2027-01-02");
  });

  it("keeps a page copied the day after its reset, before the reset landed", () => {
    expect(unwrap(parse({ asOf: "2026-04-01", text: exportText() })).monthly.resetsOn).toBe("2026-03-31");
  });

  it("refuses a capture day more than a day after the page's reset", () => {
    const error = unwrapErr(parse({ asOf: "2026-04-05", text: exportText() }));
    expect(error.code).toBe("CAPTURE_OUTSIDE_PERIOD");
    expect(error.message).toBe(
      "--as-of 2026-04-05 is more than a day after the reset the page names (2026-03-31), so the page cannot have been copied then — is --as-of the day it was copied?",
    );
  });

  it("refuses a capture day months after the page's reset", () => {
    const text = exportText({
      replace: { "- Monthly:": "- Monthly: 10.00 AUD of 2,000.00 AUD (0.5%), resets Sep 30" },
    });
    const error = unwrapErr(parse({ asOf: "2026-12-20", text }));
    expect(error.code).toBe("CAPTURE_OUTSIDE_PERIOD");
    expect(error.message).toContain("more than a day after the reset the page names (2026-09-30)");
  });

  it("refuses a capture day more than a month before the page's reset", () => {
    const error = unwrapErr(parse({ asOf: "2026-02-20", text: exportText() }));
    expect(error.code).toBe("CAPTURE_OUTSIDE_PERIOD");
    expect(error.message).toContain("more than a month before the reset the page names (2026-03-31)");
  });
});

describe("resolveResetDay", () => {
  it("keeps a reset on the capture day itself in the same year", () => {
    expect(resolveResetDay({ asOf: "2026-09-30", day: 30, month: "Sep" })).toBe("2026-09-30");
  });

  it("keeps a reset the capture day just passed, since it lands the following day", () => {
    expect(resolveResetDay({ asOf: "2026-10-01", day: 30, month: "Sep" })).toBe("2026-09-30");
  });

  it("answers undefined for a month the page never prints", () => {
    expect(resolveResetDay({ asOf: "2026-09-30", day: 30, month: "Sept" })).toBeUndefined();
  });
});

describe("isIsoDay", () => {
  it.each([
    ["2026-09-28", true],
    ["2026-02-29", false],
    ["2028-02-29", true],
    ["28 Sep", false],
  ])("%s is a real day: %s", (text, expected) => {
    expect(isIsoDay({ text })).toBe(expected);
  });
});
