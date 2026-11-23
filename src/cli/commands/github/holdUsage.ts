/**
 * The usage lines of `slopweaver github hold` and `github release`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/githubPullRequestActions.ts` (`hold`) and `cli/manifests/github.ts` (`release`)
 * read these strings on EVERY invocation, because `--help`, `catalog` and `discoverCommands` enumerate the manifest
 * barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

import { HOLD_LEDGER_DEFAULT_LIMIT } from "../../../outbound/github/holdLedgerLimits.js";
import { DEFAULT_HOLD_STALE_MINUTES } from "../../../outbound/github/mergeHold.js";

/** `slopweaver github hold`'s usage line. */
export const GITHUB_HOLD_USAGE =
  "usage: slopweaver github hold --pr <n> --repo <owner/name> --why <text> [--stale-minutes <n>] [--json]\n" +
  "                             [--home <dir>]\n" +
  "       slopweaver github hold --status [--json] [--home <dir>]\n" +
  "       slopweaver github hold --history [--limit <n>] [--json] [--home <dir>]\n" +
  "  Give ONE pull request the merge queue. While the hold stands, `slopweaver github merge` AND\n" +
  "  `slopweaver github enqueue` REFUSE every other pull request in that repository — a refusal each\n" +
  "  session meets at its own landing step, instead of a message each session has to read. Taking a pull\n" +
  "  request back OUT of a queue is exempt. At most one hold per repository; a second is refused, not queued.\n" +
  "  It is advisory by mechanism: `gh pr merge`, GitHub's own 'Merge when ready' button and an\n" +
  "  administrator override still bypass it entirely.\n" +
  "  --pr <n>           the pull request that owns the queue while this stands\n" +
  "  --repo <owner/name>  the repository whose merges this holds; merges in any other are untouched\n" +
  "  --why <text>       why the queue is held, in your own words; printed verbatim in every refusal\n" +
  "  --stale-minutes <n>  warn on the supervisor stream once the hold has stood this long (default " +
  `${String(DEFAULT_HOLD_STALE_MINUTES)})\n` +
  "  --status           report every standing hold, its age, and whether its holder is still a live session\n" +
  "  --history          report the journalled held/released/stale rows instead, newest last\n" +
  `  --limit <n>        how many journalled rows --history reports (default ${String(HOLD_LEDGER_DEFAULT_LIMIT)})\n` +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home holding the record";

/** `slopweaver github release`'s usage line. */
export const GITHUB_RELEASE_USAGE =
  "usage: slopweaver github release --pr <n> --repo <owner/name> [--sha <sha>] [--home <dir>]\n" +
  "  Clear the merge hold that `slopweaver github hold` placed, so every other pull request in the\n" +
  "  repository may merge through the door again. An administrator merge does this itself the moment it\n" +
  "  lands the held pull request, so this verb is for the hold that outlived its reason.\n" +
  "  --pr <n>           the held pull request; a hold on a DIFFERENT number is refused, never released\n" +
  "  --repo <owner/name>  the repository whose hold this clears\n" +
  "  --sha <sha>        the commit the held pull request landed as, recorded on the supervisor stream\n" +
  "  --home <dir>       the state home holding the record";
