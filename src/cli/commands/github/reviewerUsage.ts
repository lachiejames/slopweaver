/**
 * `github reviewer`'s usage text, in a leaf that imports nothing, so the manifest can print it without loading
 * the command (`.claude/rules/area-cli.md` § Metadata is eager, the run function is lazy).
 */

/**
 * The usage text, one source for `--help` and the manifest.
 *
 * @returns the usage block
 */
export function githubReviewerUsage(): string {
  return (
    "usage: slopweaver github reviewer list [--home <dir>] [--json]\n" +
    "       slopweaver github reviewer pick --repo <name> --number <n> --reviewer <U…> --verdict approve|decline\n" +
    "                                       [--feedback <why>] --by-session <who> [--home <dir>] [--json]\n" +
    "       slopweaver github reviewer read --repo <name> --number <n> --message <permalink>\n" +
    "                                       (--ask --to <id,...> | --non-ask --why <text>) --quote <line>\n" +
    "                                       --by-session <who> [--home <dir>] [--json]\n" +
    "       slopweaver github reviewer backfill --repo <owner/name> --author <login> [--apply] [--home <dir>]\n" +
    "                                           [--json]\n" +
    "  list: per open pull request in the LAST recorded `github landing` reading, who it is on the hook with —\n" +
    "  asked (the newest ask's person, where, when, whether to ask again), picked, nobody asked, not due (a\n" +
    "  draft or stacked) or not known — and, when nobody usefully is, a suggested reviewer: a named code owner,\n" +
    "  else who you asked on earlier pull requests owned by the same team, else in the same repository. No\n" +
    "  GitHub or Slack call; exits 3 when no landing reading is recorded.\n" +
    "  pick: record your verdict on one suggested reviewer. An approve then PARKS the ask, one message as you\n" +
    "  in a DM to that person, through `slack draft record`'s own gates, for your yes on the queue; a held ask\n" +
    "  to them about that pull request is reused. Sends NOTHING; the row reads 'picked' until a later reading\n" +
    "  sees the ask. A park that fails keeps the pick and exits 1. A decline needs --feedback, parks nothing,\n" +
    "  and that person is never suggested on that pull request again. --repo is the name or owner/name.\n" +
    "  read: record a VISIBLE session's reading of one message the landing could not settle — an ask of\n" +
    "  --to (people or a S… group) or not (--why). Reads the message through the Slack door and REFUSES unless\n" +
    "  --quote is in its text verbatim (mentions as <@U…>) and it, or any message of its thread, links the\n" +
    "  pull request. The next landing honours it over the classifier; an ask no Slack leg found joins as\n" +
    "  leg 'read'. A later read of the same message supersedes it. Sends nothing.\n" +
    "  backfill: every ask the local Slack corpus holds on --author's pull requests in --repo (from the GitHub\n" +
    "  corpus, open or closed), classified exactly as the landing classifies one, with the code-owner teams\n" +
    "  GitHub applied to each pull request read live, one read per pull request with an ask. Reports what it\n" +
    "  would write; --apply writes it. A pull request whose GitHub read fails writes none of its asks, so a\n" +
    "  rerun writes it whole. Asks already held are skipped. Sends nothing.\n" +
    "\n" +
    "example: slopweaver github reviewer list --json"
  );
}
