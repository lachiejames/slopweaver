/**
 * The usage lines of `slopweaver github branch` and `github tag`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/githubRefs.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const GITHUB_BRANCH_USAGE =
  "usage: slopweaver github branch delete --repo <owner/name> --branch <name> [--keep-as-tag <tag>] " +
  "(--expect-tip <sha> | --dry-run) [--json] [--home <dir>]\n" +
  "  Delete a branch on the remote through the door, then read it back to confirm it is gone.\n" +
  "  Refuses the default branch, a branch that does not exist, and a branch any OPEN pull request names as\n" +
  "  its base or head — each refusal names what it found.\n" +
  "  --keep-as-tag <tag>  first tag the live tip as <tag> on the remote, in the same door action, so the whole\n" +
  "                       branch stays recoverable; refused if <tag> already points at another commit\n" +
  "  --expect-tip <sha>   REQUIRED for a real delete: the full tip the dry run printed. Refused if the branch\n" +
  "                       has moved since, so the delete is exactly the one that was read\n" +
  "  --dry-run            read the live state and print the tip and what would happen, with no write or door\n" +
  "                       record\n" +
  "  --json               machine-readable output\n" +
  "  --home <dir>         the state home whose door records the write";

/** `slopweaver github tag`'s usage line. */
export const GITHUB_TAG_USAGE =
  'usage: slopweaver github tag create --repo <owner/name> --tag <name> --sha <commit> [--message "…"] ' +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  Create a tag on the remote at a commit it already holds, through the door, then read it back.\n" +
  "  Pushes no objects: a commit the remote does not have is refused by name. A tag already there at the\n" +
  "  same commit is reported and nothing is written; one at a different commit is refused, naming both.\n" +
  '  --message "…"       make it an annotated tag carrying this message; omit for a lightweight tag\n' +
  "  --dry-run           read the live state and print what would happen, with no write or door record\n" +
  "  --json              machine-readable output\n" +
  "  --home <dir>        the state home whose door records the write";
