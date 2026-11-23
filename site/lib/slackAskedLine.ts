/**
 * The Pull requests page's `slack` line: whether a review was asked in Slack, and the verb's reason when it gave
 * one. A bounded read with no ask reports its reason as `""` (`slackReviewState`'s `absenceBounded`), so a blank
 * reason is no reason, never a dangling `asked: no ()`. The reason sits in brackets, so it reads as the answer's
 * explanation rather than a second field after a second colon. Pure.
 */

/**
 * The line's value for one row.
 *
 * @param asked the verb's yes, no or unknown on whether a review was asked in Slack
 * @param why the verb's reason, absent or blank when it gave none
 * @returns `asked: <asked>`, followed by ` (<why>)` as the verb wrote it only when the reason carries words
 */
export function slackAskedLine({ asked, why }: { asked: string; why: string | undefined }): string {
  if (why === undefined || why.trim() === "") {
    return `asked: ${asked}`;
  }
  return `asked: ${asked} (${why})`;
}
