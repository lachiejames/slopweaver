/**
 * Typed failures for scanning a judgement-mining source tree ({@link ./sourceScan}). A source that cannot be
 * read is refused by name rather than dropped: a brief silently missing one source would be mined, accepted
 * and pinned as though it had seen everything.
 */

/** A directory or file inside a named source could not be read. */
export interface JudgementSourceUnreadableError {
  readonly code: "JUDGEMENT_SOURCE_UNREADABLE";
  readonly message: string;
  readonly label: string;
  readonly path: string;
}

/** Every way scanning a judgement-mining source can fail. */
export type JudgementSourceScanError = JudgementSourceUnreadableError;

/** Factories for {@link JudgementSourceScanError} — the one place its message text is composed. */
export const JudgementSourceScanErrors = {
  /**
   * Build a {@link JudgementSourceUnreadableError}.
   *
   * @param label the source's generic label, as the sources manifest names it
   * @param path the directory or file that refused the read
   * @param detail the boundary's own message for the failed read
   * @returns the typed error
   */
  unreadable: ({
    label,
    path,
    detail,
  }: {
    label: string;
    path: string;
    detail: string;
  }): JudgementSourceUnreadableError => ({
    code: "JUDGEMENT_SOURCE_UNREADABLE",
    label,
    message: `source ${label}: could not read ${path} (${detail}) — fix its permissions or drop it from the sources manifest`,
    path,
  }),
} as const;
