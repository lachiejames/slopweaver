/**
 * The usage text and flag names for `slopweaver github exposure` — a leaf the manifest can import without loading
 * the command (`.claude/rules/area-cli.md`).
 */

export const EXPOSURE_STRING_FLAGS = ["repo", "home"] as const;
export const EXPOSURE_BOOLEAN_FLAGS = ["json"] as const;

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_EXPOSURE_FLAG_NAMES: readonly string[] = [...EXPOSURE_STRING_FLAGS, ...EXPOSURE_BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/**
 * The usage text for `github exposure`.
 *
 * @returns exact command help, naming only the flags its parser accepts
 */
export function githubExposureUsage(): string {
  return (
    "usage: slopweaver github exposure inventory|sweep --repo <owner/name> [--json] [--home <dir>]\n" +
    "  inventory  count what every surface of a repository holds that becomes public when it is switched public:\n" +
    "             settings, refs (pull refs of deleted branches included), commits and their identities, every\n" +
    "             file version, pull requests, issues, reviews and every comment kind, referenced uploads,\n" +
    "             statuses, check runs, Actions workflows, runs, jobs and artifacts, releases, labels, milestones,\n" +
    "             deployments, environments, discussions, Pages, wiki and the events feed. Counts only.\n" +
    "  sweep      read the same surfaces and run the hygiene scan (leak classes, the private denylist, the\n" +
    "             forbidden identifiers) and a mailbox-address rule over every piece of their text, every line\n" +
    "             each commit added to a file, and every job's log. Each finding, with where it sits, and each\n" +
    "             uploaded asset, with every place linking it, is written to evidence/github-exposure/ under the\n" +
    "             state home (0700/0600). An upload's bytes are never fetched: they are left for a visible session\n" +
    "             to look at. The output carries counts and that directory's name, never a match or an upload URL.\n" +
    "  Neither prints an identity, body or ref name, and neither edits, deletes or posts anything.\n" +
    "  --repo <owner/name>  the repository; required\n" +
    "  --json               emit the report as one machine-readable document (a sweep's carries no finding)\n" +
    "  --home <dir>         the Slopweaver state home: its GitHub credential, denylist and evidence directory\n" +
    "  inventory exits 0 when every surface was counted, off, or out of the API's reach; sweep exits 0 only\n" +
    "  when every surface's text was read and nothing was found. Both exit 1 otherwise, or when the repository\n" +
    "  could not be read (the report still prints), and 2 on a usage error."
  );
}
