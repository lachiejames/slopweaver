/**
 * The one line-ending difference GitHub introduces into a pull-request description.
 *
 * GitHub's web editor stores a description with CRLF while the renderer writes LF. Every reader that judges a
 * description's CONTENT — the parser, the ledger cache's prefix check, the body digest a `--pull` file carries, and
 * the update verb's no-op test — reads it through this one function, so no two of them can disagree about whether a
 * CRLF body is the description they rendered.
 */

/**
 * Read every CRLF as LF.
 *
 * @param text a description body as sent or as GitHub stored it
 * @returns the body with each CRLF pair replaced by a single LF, and nothing else changed
 */
export function lfLineEndings({ text }: { text: string }): string {
  return text.replaceAll("\r\n", "\n");
}
