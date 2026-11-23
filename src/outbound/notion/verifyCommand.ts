/**
 * The one sentence every Notion write verb ends on, and the command it names.
 *
 * It lives in its own module because three callers print it — `notion page create`, `notion page update` and
 * `notion attach` — and a write path that told people to run a verb whose name had moved would be
 * worse than one that said nothing. One definition, three importers, and the canon test that reads the
 * manifest can see all of them.
 *
 * Pure: a URL in, lines out.
 */

/**
 * The exact command that verifies a published page.
 *
 * @param pageUrl the page a reader would open
 * @returns the command line to run, verbatim
 * @internal
 */
export function verifyCommandFor({ pageUrl }: { pageUrl: string }): string {
  return `slopweaver notion verify ${pageUrl}`;
}

/**
 * What a write verb prints on success — that the write is not the finish line, and how to reach it.
 *
 * Worded as an unfinished job rather than a suggestion on purpose. The failure this closes was a session
 * that published a page, had no way to read a block's children through any door verb, and reported the page
 * good on the strength of the markdown it had sent. "Consider verifying" would have been read the same way
 * that session read its own success message.
 *
 * @param pageUrl the page that was just written
 * @returns the lines to print after the outcome
 */
export function verifyReminderLines({ pageUrl }: { pageUrl: string }): readonly string[] {
  return [
    "NOT verified yet: what you sent is markdown, and what a reader sees is Notion's conversion of it.",
    `Open it and check:  ${verifyCommandFor({ pageUrl })}`,
  ];
}
