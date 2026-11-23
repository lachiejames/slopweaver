/**
 * The usage lines of `slopweaver github`'s read-and-report verbs — review-state, search, turn-path and watchers, and
 * nothing else.
 *
 * A LEAF on purpose: `cli/manifests/github.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/**
 * The usage text for `github review-state`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubReviewStateUsage(): string {
  return (
    "usage: slopweaver github review-state [--repo <owner/name,...>] [--author <login>] [--number <n>] " +
    "[--detail] [--include-drafts] [--no-slack-live] [--limit <n>] [--check-limit <n>] [--file-limit <n>] " +
    "[--json] [--home <dir>]\n" +
    "  Answers SEVEN questions about every open pull request the selection matches: is CI all green; is\n" +
    "  CodeRabbit all green; is it undrafted; which CODEOWNERS rules it still OWES a review; was it mentioned in\n" +
    "  Slack at any point; has anybody been explicitly asked to review it; has that ask gone stale.\n" +
    "  With --detail (implied by --number) it also prints the GRANULAR state a reader judges from rather than\n" +
    "  a verdict: every unresolved thread with who raised it, its first line and whether we answered it\n" +
    "  without resolving it; and every non-passing check with whether the base branch REQUIRES it.\n" +
    "  Read-only: no pull request, comment, review request or Slack message is written or changed.\n" +
    "  An absence is only ever reported over a WINDOW. Where Slack cannot bound one, the answer is `unknown`\n" +
    "  rather than `no`, and the row says why.\n" +
    "  --repo <owner/name,...>  one or more repositories, comma-separated; default the current checkout's\n" +
    "                     `origin` remote\n" +
    "  --author <login>   only pull requests opened by this login\n" +
    "  --number <n>       one pull request, by number — needs exactly one --repo. Implies --detail\n" +
    "  --detail           also print the granular block per pull request: unresolved threads with who raised\n" +
    "                     them and what they say, and which failing checks are required. Reads comment\n" +
    "                     bodies, which the table never needs\n" +
    "  --include-drafts   include draft pull requests, which are excluded by default\n" +
    "  --no-slack-live    skip the live Slack search leg and answer from the local corpus alone. Faster, and\n" +
    "                     blind to everything posted since the corpus was last refreshed\n" +
    "  --limit <n>        stop after this many pull requests (default 100; GitHub's search caps at 1000)\n" +
    "  --check-limit <n>  cap the check contexts requested per pull request (default 60)\n" +
    "  --file-limit <n>   cap the changed paths requested per pull request (default 100); a pull request with\n" +
    "                     more says so rather than reporting a partial owner list as complete\n" +
    "  --json             emit one machine-readable document instead of the table\n" +
    "  --home <dir>       resolve the credentials, corpus and roster from this Slopweaver state home\n" +
    "  The OWNERS cell reads what is still OWED: one approval satisfies ONE codeowner rule, never all of\n" +
    "  them. A team GitHub recorded an approval on behalf of is approved; one it still has a request out to\n" +
    "  is owed; a team with neither is `unproven`, never ready.\n" +
    "  Owners are joined by their CONNECTIVE, never by a space: `AND` between rules, which each need their own\n" +
    "  approval, and `OR` inside one rule, which any one of its owners satisfies. With --detail the\n" +
    "  `codeowner teams` line says the same thing for TEAMS alone — which teams the review depends on,\n" +
    "  whether it is an AND or an OR, and where a named person could clear the rule instead of the team.\n" +
    "  Above both, the `github codeowners` line is GITHUB's OWN answer, never a reading of the CODEOWNERS\n" +
    "  file: the review requests GitHub flagged `asCodeOwner`, plus the teams an approval was submitted on\n" +
    "  behalf of. It names WHO and states no connective, because GitHub's API states none."
  );
}

/**
 * The usage text for `github search`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubSearchUsage(): string {
  return (
    "usage: slopweaver github search <term> [--repo <owner/name>] [--limit <1..100>] [--complete] [--json] [--home <dir>]\n" +
    "  Finds a matching issue or pull request by GitHub's own search — not a fuzzy or model-based match.\n" +
    "  <term>             the search term; GitHub's own query syntax (is:pr, label:x, …) is passed through\n" +
    "  --repo <owner/name>  the repository to search; default the current checkout's `origin` remote, REFUSED\n" +
    "                     when the cwd is under $SLOPWEAVER_HOME or is not a declared main checkout's repository\n" +
    "  --limit <1..100>   cap the number of results requested (default 10, or 100 under --complete)\n" +
    "  --complete         the matches must be the WHOLE set: refuses (exit 1, nothing on stdout) when the\n" +
    "                     page held fewer than totalCount, instead of handing back a relevance-ordered sample\n" +
    "  --json             emit one machine-readable document with the matches and coverage (complete|bounded)\n" +
    "  --home <dir>       resolve the credential from this Slopweaver state home"
  );
}

/**
 * The usage text for `github turn-path`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubTurnPathUsage(): string {
  return (
    "usage: slopweaver github turn-path --head <ref> [--base <ref>] [--repo <owner/name>] [--number <n>] " +
    "[--cwd <dir>] [--remote <name>] [--json]\n" +
    "  Fetches one pull request's head into a private, per-invocation ref and diffs it against a base ref,\n" +
    "  reporting whether any changed path falls under the bot's own loop chain's turn-path prefix set.\n" +
    "  Refuses rather than reporting a false CLEAN on an empty --head or a fetch that resolves to the base\n" +
    "  itself — the empty-refspec fail-open a hand-rolled shell recipe could not see.\n" +
    "  --head <ref>       the pull request's head branch name (GitHub's `headRefName`) — refused if empty or\n" +
    "                     whitespace, before it ever reaches a Git refspec\n" +
    "  --base <ref>       the ref to diff against (default: origin/main)\n" +
    "  --repo <owner/name>  report label only — this verb never calls the GitHub API\n" +
    "  --number <n>       report label only — the pull-request number\n" +
    "  --cwd <dir>        the repository to fetch and diff in (default: current directory)\n" +
    "  --remote <name>    the configured Git remote to fetch from (default: origin)\n" +
    "  --json             emit one machine-readable document instead of a status line"
  );
}

/**
 * The usage text, one source for `--help` and the manifest.
 *
 * @returns the usage block
 */
export function githubWatchersUsage(): string {
  return (
    "usage: slopweaver github watchers [--repo <owner/name>] [--home <dir>] [--json]\n" +
    "  Who is WATCHING each pull request, folded from the checks-read register alone: a visible session\n" +
    "  holding a `github checks` wait or until loop writes a `watching` row on its first read and a\n" +
    "  `watch-done` row when the loop returns. A watcher older than its own timeout ceiling with no\n" +
    "  watch-done is reported STALE — a dead session, never a watcher. Every pull request the register\n" +
    "  names also carries its last read: when, which head, what the rollup said. Nothing here reaches\n" +
    "  GitHub; the answer is only as fresh as the register, and --json says when it was folded.\n" +
    "  --repo <owner/name>  only this repository's pull requests\n" +
    "  --json               one object: observedAtIso, then one entry per pull request\n" +
    "\n" +
    "example: slopweaver github watchers --json"
  );
}
