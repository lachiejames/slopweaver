/**
 * `slopweaver github bottleneck`'s usage line and the default it quotes, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/githubReports.ts` reads these strings on EVERY invocation, because `--help`,
 * `catalog` and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a
 * command module, a string would put that module and everything it imports on every invocation's load path. The command
 * modules import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The default ceiling on how many pull requests one audit reads. */
export const DEFAULT_LIMIT = 100;

/**
 * The usage text for `github bottleneck`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubBottleneckUsage(): string {
  return (
    "usage: slopweaver github bottleneck [--repo <owner/name,...>] [--author <login>] [--exclude-drafts]\n" +
    "                                   [--slack-live] [--limit <n>] [--json] [--home <dir>]\n" +
    "  Group every open pull request by WHERE it is waiting and on what, so a backlog names the mechanism to\n" +
    "  fix rather than the pull request to nudge. Read-only: it writes nothing and presses nothing.\n" +
    "  Each row falls to exactly ONE cause, first match down a fixed ladder — queued, conflicting, draft,\n" +
    "  review-owed, threads-open, ci-red, ci-running, unread, clear — and carries every other test it also\n" +
    "  fails beside it. The ladder's order is the argument: a row GitHub already holds an entry for is owed\n" +
    "  nothing by this fleet, and a draft outranks its own red CI because ten renovate drafts are one\n" +
    "  mechanism rather than ten CI problems.\n" +
    "  Two ages, never one: how long it has been OPEN, and how long since GitHub saw any activity. The second\n" +
    "  is not the wait — GitHub bumps `updatedAt` on a check re-run, so a pull request that is 324 commits behind\n" +
    "  `main` with eight checks failing can read four hours idle.\n" +
    "  DRAFTS ARE INCLUDED by default, which is the opposite of `github landing`. A draft nobody undrafts is\n" +
    "  the commonest bottleneck here, and 17 of 22 open pull requests were drafts when this verb was written.\n" +
    "  --repo <owner/name,...>  one or more repositories, comma-separated; default the current checkout's\n" +
    "                     `origin` remote\n" +
    "  --author <login>   only pull requests opened by this login\n" +
    "  --exclude-drafts   leave drafts out, which drops the audit back to what `github landing` sees\n" +
    "  --slack-live       also run the LIVE Slack search, one per pull request, on top of the corpus scan\n" +
    `  --limit <n>        stop after this many pull requests (default ${String(DEFAULT_LIMIT)})\n` +
    "  --json             emit one machine-readable document instead of the histogram\n" +
    "  --home <dir>       resolve the credentials and the board from this Slopweaver state home\n" +
    "  What it cannot answer, stated rather than guessed: whether a SEAT ended without landing. The board\n" +
    "  join is a row's declared `branch:` or its run's recorded one, so a pull request no row stated answers\n" +
    "  `undeclared` rather than `no seat`, and the report carries that as residue."
  );
}
