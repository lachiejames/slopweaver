/**
 * `slopweaver github alert`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/githubCodeScanning.ts` reads these strings on EVERY invocation, because `--help`,
 * `catalog` and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a
 * command module, a string would put that module and everything it imports on every invocation's load path. The command
 * modules import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const GITHUB_ALERT_USAGE =
  "usage: slopweaver github alert <list|dismiss> --repo <owner/name> [...] [--dry-run] [--json] [--home <dir>]\n" +
  "  list               every code-scanning (CodeQL) alert on the repository, open by default\n" +
  "  list [--pr <n>] [--state open|dismissed|fixed]\n" +
  "  --pr <n>           list only: scope to one pull request's head ref, rather than the whole repository\n" +
  "  --state <s>        list only: open (default), dismissed or fixed — exactly GitHub's own state enum\n" +
  "  dismiss            dismiss one alert with a reason GitHub's own enum accepts, after re-reading it\n" +
  "  dismiss --number <n> --reason <false_positive|wont_fix|used_in_tests> --comment <text>\n" +
  "  --number <n>       dismiss only: the alert's number, as `list` prints it\n" +
  "  --reason <r>       dismiss only: false_positive, wont_fix or used_in_tests — refused outside this set\n" +
  "  --comment <text>   dismiss only: why — required, at most 280 characters (GitHub's own dismissal comment\n" +
  "                     limit), and printed alongside the dismissal it wrote\n" +
  "  --repo <owner/name>  the repository\n" +
  "  --dry-run          print the exact plan and send nothing; no door record\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose door records the write";
