/**
 * The usage lines of `slopweaver onboard` and its `eval` and `plan` verbs, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/onboard.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The single usage line, printed on a parse error and by `--help`. */
export const ONBOARD_USAGE =
  "usage: slopweaver onboard [--tier agent|standard|restricted] [--app-name <name>]\n" +
  "                          [--identity <name>] [--mailbox-zone <zone>] [--json]\n" +
  "  Asks what it cannot derive, renders the Slack app manifest to paste, and names what each tier costs.\n" +
  "  --tier          agent (the default, and the least secure — and its Agents panel CANNOT be undone),\n" +
  "                  standard (the same bot, all of it revertible) or restricted (ingest only); skips the question\n" +
  "  --app-name      the Slack app's name (default: Slopweaver); skips the question\n" +
  "  --identity      whose assistant plan the org-owned mailbox is for — the address leads with it. Never\n" +
  "                  asked and never guessed: given with --mailbox-zone, the mailbox step prints YOUR two\n" +
  "                  addresses instead of the shape\n" +
  "  --mailbox-zone  a Cloudflare zone your organisation holds, which those addresses live on\n" +
  "  --json          emit the manifest, every tier's trade and every scope's justification as JSON, asking nothing";

/** The command's complete help text. */
export const ONBOARD_EVAL_USAGE =
  "usage: slopweaver onboard eval [--run <path>] [--schema] [--eval-home <dir>] [--file-findings <n>] " +
  "[--repo <path>] [--json]\n" +
  "  Score one onboarding self-evaluation run: render the friction report, diff it against the previous\n" +
  "  run, and optionally file the top N findings as board docs.\n" +
  "  --run            path to the run artifact JSON a fresh evaluating session wrote (see --schema)\n" +
  "  --schema         print the exact JSON shape a run artifact must match, and exit\n" +
  "  --eval-home      where report history and filed findings live (default: ~/.slopweaver, independent\n" +
  "                   of $SLOPWEAVER_HOME — the run's own home is a throwaway exercise home and must not\n" +
  "                   hold this)\n" +
  "  --file-findings  file the top N findings as new handover board docs (default: 0 — file none)\n" +
  "  --repo           the repo: a filed finding doc names (default: cwd, minus any .claude/worktrees/<slug>)\n" +
  "  --json           emit the report + delta as one JSON document";

/** The command's complete help text. */
export const ONBOARD_WORKSTREAMS_USAGE =
  "usage: slopweaver onboard workstreams [--home <dir>] [--json]\n" +
  "  Where onboarding's workstreams step stands: pull (no source holds anything yet; one is enough, Notion alone\n" +
  "  included), mine (a pulled source or a proposal no mine has read), react (candidates wait on the person's word\n" +
  "  at the console's /workstreams#candidates) or answered — and whether the console has candidates to show. Reads\n" +
  "  the bronze each source holds and the candidates document; writes nothing. Mining is the visible session's\n" +
  "  pass, written with `workstreams candidates-put`. Exits 3 at pull, while no source holds anything and nothing\n" +
  "  has been mined; --json prints that pull reading, with every source and the bytes it holds (zero included), and\n" +
  "  exits 0, so a reader tells the fresh install apart from a failed read.\n" +
  "\n" +
  "example: slopweaver onboard workstreams --json";

/** The command's complete help text. */
export const ONBOARD_PLAN_USAGE =
  "usage: slopweaver onboard plan --sources github,slack,linear,notion,gmail --backfill 90|all|YYYY-MM-DD " +
  "[--repo owner/repo --github-org owner] [--json]\n" +
  "  Emits one independent refresh command per connected source. Launch all emitted commands concurrently.\n" +
  "  In JSON, each commands[].argv is the tail after the slopweaver executable.\n" +
  "  --sources     comma-separated connected sources (github, slack, linear, notion, gmail)\n" +
  "  --backfill    positive day count, YYYY-MM-DD, or all\n" +
  "  --repo        required when github is selected\n" +
  "  --github-org  GitHub organisation (defaults to the --repo owner)\n" +
  "  --json        emit the argv arrays as one JSON document";
