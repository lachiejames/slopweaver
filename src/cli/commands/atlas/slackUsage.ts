/**
 * The usage lines of `slopweaver atlas slack`, `slack-api` and `slack-drive`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/atlasSlack.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_SLACK_USAGE =
  "usage: slopweaver atlas slack [--never-read] [--unreadable] [--json] [--home <dir>]\n" +
  "  (no flag)         the map: how many conversations exist, how many you can read, how many you have\n" +
  "  --never-read      list the READABLE conversations nobody has looked at yet\n" +
  "  --unreadable      list the conversations this account cannot open, and why\n" +
  "  --json            emit one machine-readable document on stdout\n" +
  "  reads only what `refresh` already stored; it makes no network call\n" +
  "  reset --confirm archive [--json] [--home <dir>]\n" +
  "                    archive the generation `atlas slack-drive` published and install an empty one this\n" +
  "                    build can write — the remedy printed when that generation is refused\n" +
  "  restore [--archive <archive-id> --confirm archive-current] [--json] [--home <dir>]\n" +
  "                    list the generations `reset` archived, or put one back as the live generation";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_SLACK_API_USAGE =
  "usage: slopweaver atlas slack-api [--method <term>] [--field <term>] [--browser] [--from-har <file>] [--json]\n" +
  "  (no flag)         what the map holds: methods, params, response fields, and how many carry docs\n" +
  "  --method <term>   every method whose name contains <term>, with its params, tier and scopes\n" +
  "  --field <term>    which methods RETURN a field whose name contains <term> — the unknown-unknown lookup\n" +
  "  --browser         the undocumented surface the first-party web client calls\n" +
  "  --from-har <file> regenerate the committed browser table from a capture, to stdout — see browser.ts\n" +
  "  --json            emit one machine-readable document on stdout\n" +
  "  reads the installed @slack/web-api typings and two committed tables; it makes no network call";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const ATLAS_SLACK_DRIVE_USAGE =
  "usage: slopweaver atlas slack-drive <plan|sync|refresh|report> [--session <path>] [--dry-run] " +
  "[--home <dir>] [--json]\n" +
  "  plan            print the BRIEF: every page the DECLARED surface map names, to walk in YOUR own\n" +
  "                  Chrome, with each one's screenshot policy. Nothing here opens a browser\n" +
  "                  (docs/browser-route.md), and it records nothing\n" +
  "  sync            read the walk document that brief produced, read the installed SDK, and publish one\n" +
  "                  generation holding both surfaces\n" +
  "  refresh         the unattended half: read the installed SDK, publish the API surface onto whatever the\n" +
  "                  last walk left, then print the same brief `plan` prints — what `resync-atlas-slack`\n" +
  "                  runs on a scheduled pass, and the walk it briefs is the seated session's to carry out\n" +
  "  report          read the published generation and print where the two surfaces disagree\n" +
  "  --session <p>   sync only: the walk document, or `-` for stdin. Each page names a LOCAL png path;\n" +
  "                  sync digests the bytes itself and refuses a picture the surface map said not to take\n" +
  "  --dry-run       compare, but write no generation\n" +
  "  --home <dir>    the state home to publish under; defaults to $SLOPWEAVER_HOME\n" +
  "  --json          emit one machine-readable document on stdout\n" +
  "  None of the four opens a browser or makes a network call of its own.";
