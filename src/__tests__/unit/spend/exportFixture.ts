/**
 * A synthetic card-page export in the shape the owner pastes — every name and number invented, so no real
 * card spend is ever committed. The shape (headings, list lines, table header, status words) is the real
 * page's; the values are chosen so each report property has one exact expected answer.
 */

/** The table rows of {@link exportText}, newest first as the page lists them. */
export const FIXTURE_ROWS: readonly string[] = [
  "| 2026-03-26 | OpenAI | 10.00 USD | |",
  "| 2026-03-26 | Anthropic | 200.00 AUD | |",
  "| 2026-03-25 | ChatGPT San Francisco | 120.00 AUD | Declined |",
  "| 2026-03-25 | ChatGPT San Francisco | 120.00 AUD | Declined |",
  "| 2026-03-22 | OpenAI | 120.00 AUD | |",
  "| 2026-03-22 | Anthropic | 0.00 USD | Card verification |",
  "| 2026-03-10 | Anthropic | 300.00 AUD | Declined |",
  "| 2026-02-20 | ANTHROPIC* CLAUDE SUB | 150.00 AUD | Cancelled |",
  "| 2026-02-20 | Anthropic | 1,150.00 AUD | |",
  "| 2026-02-20 | Google Chrome | 0.00 AUD | Declined |",
];

/**
 * Build a synthetic export, with any line swapped or dropped.
 *
 * @param replace a line prefix mapped to its replacement, or to null to drop that line
 * @param rows the table rows under the header
 * @returns the export text
 */
export function exportText({
  replace = {},
  rows = FIXTURE_ROWS,
}: {
  replace?: Readonly<Record<string, string | null>>;
  rows?: readonly string[];
} = {}): string {
  const lines = [
    "# Card export",
    "",
    "Organisation: EXAMPLE TRADING PTY LTD",
    'Card: "Subs | AI | Test", company card, virtual Visa Business debit, ending 0042, Active',
    "Merchant control: Allow Anthropic, OpenAI, ChatGPT. Transaction types: 2 enabled.",
    "",
    "Limits (reset at 10:00 AM UTC+10 the following day):",
    "- Monthly: 1,900.00 AUD of 2,000.00 AUD (95.0%), resets Mar 31",
    "- Transaction limit: 500.00 AUD",
    "",
    "## Transactions",
    "",
    "| Date | Merchant | Amount | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Reading",
    "",
    "Free prose the parser ignores.",
  ];
  const out: string[] = [];
  for (const line of lines) {
    const key = Object.keys(replace).find((prefix) => line.startsWith(prefix));
    if (key === undefined) {
      out.push(line);
      continue;
    }
    const replacement = replace[key];
    if (replacement === null) {
      continue;
    }
    out.push(replacement!);
  }
  return out.join("\n");
}
