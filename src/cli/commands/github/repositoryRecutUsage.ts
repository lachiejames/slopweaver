/**
 * The usage lines of `slopweaver github push-root` and `github repoint-plan`, and nothing else.
 *
 * A LEAF on purpose, for the reason `./refsUsage.ts` gives: `cli/manifests/githubRecut.ts` reads these strings on
 * every invocation, and the command modules import them from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const GITHUB_PUSH_ROOT_USAGE =
  "usage: slopweaver github push-root record --repo <owner/name> --root <sha> [--cwd <dir>] [--dry-run] [--json] " +
  "[--home <dir>]\n" +
  "       slopweaver github push-root list [--json] [--home <dir>]\n" +
  "  The one root each re-cut repository accepts. Once a repository has a binding, every push to it — `github\n" +
  "  push`, every stack verb, a worktree salvage and a raw `git push` through the pre-push hook — refuses a\n" +
  "  commit whose history has any other root (`push-roots.json` in the state home).\n" +
  "  record       bind --repo to --root. The root must be a parentless commit in the checkout at --cwd. The\n" +
  "               same binding again changes nothing; a different root for a bound repository is refused.\n" +
  "  list         every binding, oldest first\n" +
  "  --dry-run    check the root and print the binding, writing nothing\n" +
  "  --json       machine-readable output\n" +
  "  --home <dir> the state home whose register is read or written";

export const GITHUB_REPOINT_PLAN_USAGE =
  "usage: slopweaver github repoint-plan --repo <owner/name> --archive-name <name> [--new-checkout <dir>] " +
  "[--json] [--home <dir>]\n" +
  "  DRY RUN ONLY: every local place that names --repo, and what the re-cut switch changes it to. It writes\n" +
  "  nothing. The old history moves to <owner>/<archive-name>, so the old checkout, every worktree of it and\n" +
  "  every state-home link to a pull request, issue or commit move to the archive's name; the fresh repository's\n" +
  "  numbers restart at 1 and would collide. The profile's main checkout, the desktop app's checkout and a\n" +
  "  plugin source inside the old checkout move to --new-checkout. Launch agents are read and reported.\n" +
  "  --new-checkout <dir>  the fresh clone; without it the plan is incomplete and exits 3\n" +
  "  --json                the whole typed plan, each action with the sha-256 of the bytes it expects\n" +
  "  --home <dir>          the state home whose links and profile are read";

/** Why a re-cut verb's invocation was refused before anything ran: every problem line, then that verb's usage. */
export interface RecutUsageError {
  readonly code: "RECUT_USAGE";
  readonly message: string;
  readonly lines: readonly string[];
}

/** The one failure a re-cut verb's parse names. */
export type RecutArgsError = RecutUsageError;

/** Builds {@link RecutArgsError}s. */
export const RecutArgsErrors = {
  usage: ({ problems, usage }: { problems: readonly string[]; usage: string }): RecutUsageError => {
    const lines = [...problems, usage];
    return { code: "RECUT_USAGE", lines, message: lines.join("\n") };
  },
} as const;
