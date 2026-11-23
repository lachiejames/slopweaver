/**
 * `github review-draft`'s usage text, in a leaf that imports nothing, so the manifest can print it without loading
 * the command (`.claude/rules/area-cli.md` § Metadata is eager, the run function is lazy).
 */

/**
 * The usage text, one source for `--help` and the manifest.
 *
 * @returns the usage block
 */
export function githubReviewDraftUsage(): string {
  return (
    "usage: slopweaver github review-draft record --repo <owner/name> --number <n> --form <json|-> --why <text>\n" +
    "                                             [--home <dir>] [--json]\n" +
    "       slopweaver github review-draft list [--all] [--home <dir>] [--json]\n" +
    "       slopweaver github review-draft show <id> [--home <dir>] [--json]\n" +
    "       slopweaver github review-draft drop <id> --note <why> [--home <dir>]\n" +
    "       slopweaver github review-draft post <id> --approve <digest> [--dry-run] [--home <dir>] [--json]\n" +
    "  A review of SOMEBODY ELSE's pull request, parked for the owner's yes before anything reaches GitHub.\n" +
    "  record: reads the pull request and its diff, refuses the owner's own pull request, a closed one, and any comment\n" +
    "  GitHub could not anchor (head side only; a range must sit in one hunk), captures the hunk each comment\n" +
    "  sits on, and parks it. Posts nothing. The form: {verdict: APPROVE|COMMENT|REQUEST_CHANGES, body,\n" +
    "  comments: [{path, line, startLine?, body}], deeperReview?} — deeperReview is the risk a deeper review\n" +
    "  would settle, shown to the owner and never posted. Body and comments pass the owner's exact voice rules.\n" +
    "  list, show: the register, no GitHub call. drop: resolve it unposted. <id> may also be given as --id <id>.\n" +
    "  post: re-reads the pull request and refuses a moved head, a merged or closed one, or a diff that no\n" +
    "  longer matches the card, then submits the whole review in one call through the door, which HOLDS unless\n" +
    "  --approve names the digest of exactly this review. The digest binds content; it is not a signature.\n" +
    "\n" +
    "example: slopweaver github review-draft list --json"
  );
}
