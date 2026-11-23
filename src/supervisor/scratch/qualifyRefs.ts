/**
 * The pure half of `slopweaver supervisor refresh-run`: qualify every bare `#<number>` in one line of text with the
 * repository it belongs to, so `briefing render --your-list run.json` never meets a bare reference.
 *
 * It replaces `refresh-run.sh`'s `sed -E 's/([^A-Za-z0-9\/])#([0-9]+)([^0-9]|$)/\1<owner>\/<repo>#\2\3/g'`,
 * which every seat copied and ran TWICE per file: the sed pattern consumes the character after the number, so
 * `#1,#2` qualified only `#1` on the first pass. A lookaround consumes nothing, so one pass is whole.
 *
 * The preceding-character exclusion is wider than the script's, on purpose. A repository name may carry `.`,
 * `_` or `-`, so `my.repo#<number>` is already qualified and the script would have produced `my.repoowner/repo#<number>`;
 * an HTML numeric entity is not an issue reference.
 *
 * No I/O.
 */

/** A `#` followed by digits, not preceded by anything that makes it part of a name, a path or an entity. */
const BARE_REF = /(?<![A-Za-z0-9_.\-/&])#(\d+)(?!\d)/gu;

/**
 * One line with every bare reference qualified.
 *
 * @param line the text, without its newline
 * @param repo the `owner/name` every bare reference belongs to
 * @returns the rewritten line and how many references it qualified
 */
export function qualifyBareRefs({ line, repo }: { line: string; repo: string }): { line: string; count: number } {
  let count = 0;
  const rewritten = line.replace(BARE_REF, (_match, digits: string) => {
    count += 1;
    return `${repo}#${digits}`;
  });
  return { count, line: rewritten };
}

/**
 * Whether a string names a repository as `owner/name`.
 *
 * @param repo the candidate
 * @returns true when it is exactly two non-empty name segments
 */
export function isRepoSlug({ repo }: { repo: string }): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo);
}
