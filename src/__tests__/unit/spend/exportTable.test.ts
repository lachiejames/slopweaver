import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseTransactions } from "../../../spend/exportTable.js";

const numbered = ({ texts }: { texts: readonly string[] }) =>
  texts.map((text, index) => ({ lineNumber: index + 1, text }));

const HEAD = ["## Transactions (2 rows)", "", "| Date | Merchant | Amount | Status |", "|---|---|---|---|"];

describe("parseTransactions", () => {
  it("reads a table ending at the end of the file, in page order", () => {
    const lines = numbered({
      texts: [...HEAD, "| 2026-03-26 | Anthropic | 200.00 AUD | |", "| 2026-03-25 | OpenAI | 5.00 USD | Declined |"],
    });
    const rows = unwrap(parseTransactions({ asOf: "2026-03-28", lines }));
    expect(rows.map((row) => [row.date, row.status, row.ordinal])).toEqual([
      ["2026-03-26", "charged", 0],
      ["2026-03-25", "declined", 1],
    ]);
  });

  it("refuses prose directly under the last row", () => {
    const lines = numbered({
      texts: [
        ...HEAD,
        "| 2026-03-26 | Anthropic | 200.00 AUD | |",
        "| 2026-03-25 | OpenAI | 5.00 USD | Declined |",
        "x",
      ],
    });
    const error = unwrapErr(parseTransactions({ asOf: "2026-03-28", lines }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("line 7: the table's closing blank line");
  });

  it("refuses a row pasted above the table header, rather than dropping it", () => {
    const lines = numbered({
      texts: ["| 2026-03-27 | OpenAI | 5.00 USD | Declined |", ...HEAD, "| 2026-03-26 | Anthropic | 200.00 AUD | |"],
    });
    const error = unwrapErr(parseTransactions({ asOf: "2026-03-28", lines }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("line 1: the transaction row above the table header line");
  });

  it.each([
    "+ | 2026-03-24 | OpenAI | 5.00 USD | Declined |",
    "1. | 2026-03-24 | OpenAI | 5.00 USD | Declined |",
    "> > | 2026-03-24 | OpenAI | 5.00 USD | Declined |",
    "`| 2026-03-24 | OpenAI | 5.00 USD | Declined |`",
  ])("refuses a row behind any marker above the header: %s", (stray) => {
    const lines = numbered({ texts: [stray, ...HEAD, "| 2026-03-26 | Anthropic | 200.00 AUD | |"] });
    const error = unwrapErr(parseTransactions({ asOf: "2026-03-28", lines }));
    expect(error.message).toContain("line 1: the transaction row above the table header line");
  });

  it("refuses a quoted row further down, after the closing blank", () => {
    const lines = numbered({
      texts: [
        ...HEAD,
        "| 2026-03-26 | Anthropic | 200.00 AUD | |",
        "| 2026-03-25 | OpenAI | 5.00 USD | Declined |",
        "",
        "> | 2026-03-24 | OpenAI | 5.00 USD | Declined |",
      ],
    });
    const error = unwrapErr(parseTransactions({ asOf: "2026-03-28", lines }));
    expect(error.code).toBe("EXPORT_LINE_MALFORMED");
    expect(error.message).toContain("line 8: the transaction row after the table ended line");
  });
});
