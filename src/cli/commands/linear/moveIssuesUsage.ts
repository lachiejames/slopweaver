/**
 * `slopweaver linear move-issues`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `issuesUsage.ts`: `cli/manifests/linear.ts` reads it on every invocation, so it
 * imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver linear move-issues`'s usage line. */
export const LINEAR_MOVE_ISSUES_USAGE =
  "usage: slopweaver linear move-issues --to <team-key> --identifier <KEY-1,KEY-2,...> [--apply] [--json] [--home <dir>]\n" +
  "  Moves the named issues into another team, each as a fields-only team move through `linear issue update`.\n" +
  "  Each keeps its title, description, assignee, parent and estimate; its state maps by exact NAME, same TYPE;\n" +
  "  it leaves its cycle and its labels. Refused per issue: in a project, carrying a label, assigned to someone\n" +
  "  else, archived, already there, a parent with children in its own team, or no single same-name, same-type state.\n" +
  "  Previews by default and writes nothing; --apply moves only a plan with no refusal, in order, stopping\n" +
  "  at the first failure. Exit 0 all move, 3 none would, 1 some refused or a write failed.\n" +
  "  --to          the destination team's key (the `SOPS` in `SOPS-42`)\n" +
  "  --identifier  the issues to move, comma-separated, each once, by their CURRENT identifier\n" +
  "  --apply       perform the moves; without it the verb only previews\n" +
  "  --json        emit one machine-readable document\n" +
  "  --home        resolve the credential and ledgers from this Slopweaver state home";
