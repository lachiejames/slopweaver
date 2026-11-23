/**
 * The usage line of `slopweaver github repo`, and nothing else.
 *
 * A LEAF for the reason `./prUsage.ts` gives: the `github` manifest reads this string on every invocation, so it
 * cannot sit in a command module. Its own file because the verb's surface outgrew the shared one's size budget.
 * Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver github repo`'s usage line. */
export const GITHUB_REPO_USAGE =
  "usage: slopweaver github repo --repo <owner/name> --description <text> [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver github repo --repo <owner/name> --rename-to <name>|--transfer-to <owner>|--archive\n" +
  "                              |--create [--public]|--set-public|--apply-manifest <path>|--enable-actions\n" +
  "                              [--approve <digest>] [--json] [--home <dir>]\n" +
  "  One write per invocation, each through the door and confirmed by a read-back\n" +
  '  --description <text>  replace the description; pass "" to clear it\n' +
  "  --dry-run          read the current description and print the change, but perform no write or door record\n" +
  "  --rename-to <name> rename the repository within its owner\n" +
  "  --transfer-to <owner>  transfer it to another account or organisation, keeping its name\n" +
  "  --archive          archive it; there is no unarchive here\n" +
  "  --create           create the repository at --repo, PRIVATE unless --public is also given; the owner is the\n" +
  "                     token's own account or an organisation, and the address must not exist yet\n" +
  "  --public           with --create only: create it public instead\n" +
  "  --set-public       make a private repository public; the preview names what GitHub changes with it\n" +
  "  --apply-manifest <path>  apply a settings apply artifact naming this repository: description, topics,\n" +
  "                     features, merge settings, labels (create only), Dependabot alerts, and once the\n" +
  "                     repository is public, protection on main, secret scanning and private vulnerability\n" +
  "                     reporting. While it is private those three wait; preview again after --set-public\n" +
  "  --enable-actions   turn GitHub Actions on under the stated policy: GitHub-hosted runners only (held while a\n" +
  "                     self-hosted runner is registered, and for an organisation's repository), GitHub-owned\n" +
  "                     actions only, every fork pull request from an outside contributor waits for approval,\n" +
  "                     the workflow token read-only and unable to approve a pull request\n" +
  "  --approve <digest> send one of the writes above bar --description; without it each only previews the live\n" +
  "                     state, the change and its ghrepo- digest. The digest is recomputed from a fresh read, so\n" +
  "                     any drift since the preview holds the write";
