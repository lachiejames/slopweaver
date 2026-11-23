/**
 * The usage text and flag names for `slopweaver github coderabbit-yield` — a leaf the manifest can import
 * without loading the command (`.claude/rules/area-cli.md`).
 */

/** The default window, in days — the owner's own framing of the question. */
export const DEFAULT_DAYS = 60;

export const YIELD_STRING_FLAGS = ["repo", "author", "days", "home"] as const;
export const YIELD_BOOLEAN_FLAGS = ["json"] as const;

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_CODERABBIT_YIELD_FLAG_NAMES: readonly string[] = [
  ...YIELD_STRING_FLAGS,
  ...YIELD_BOOLEAN_FLAGS,
].map((name) => `--${name}`);

/**
 * The usage text for `github coderabbit-yield`.
 *
 * @returns exact command help, naming only the flags its parser accepts
 */
export function githubCoderabbitYieldUsage(): string {
  return (
    "usage: slopweaver github coderabbit-yield --repo <owner/name,...> [--author <login>] [--days <n>]\n" +
    "                                         [--json] [--home <dir>]\n" +
    "  What became of every CodeRabbit finding on one author's pull requests: each thread CodeRabbit opened\n" +
    "  falls to ONE outcome, first match down a fixed ladder — reported-addressed (CodeRabbit's own\n" +
    "  `✅ Addressed` marker), reply-cites-commit (a reply names a commit), unknown (comments not all read),\n" +
    "  outdated-only, resolved-no-evidence (resolved with no sign of a change: the self-resolved count),\n" +
    "  open-no-evidence — and is cross-tabbed by severity, type, category and pull-request state.\n" +
    "  Nitpicks and outside-diff comments live in review BODIES, not threads, so they are counted apart\n" +
    "  with no outcome. Read-only: it resolves, replies and posts nothing.\n" +
    "  The cohort is pull requests CREATED in the window, read as they stand now. A search over GitHub's\n" +
    "  1,000-result ceiling is split by creation time until each piece fits, never truncated.\n" +
    "  --repo <owner/name,...>  one or more repositories, comma-separated; required\n" +
    "  --author <login>   whose pull requests; default the login the GitHub token belongs to\n" +
    `  --days <n>         how far back pull requests were opened (default ${String(DEFAULT_DAYS)})\n` +
    "  --json             emit one machine-readable document, every finding with its link\n" +
    "  --home <dir>       resolve the GitHub credential from this Slopweaver state home\n" +
    "  Exits 0 on a complete read, 1 when a read failed or left a coverage gap (the document still prints),\n" +
    "  2 on a usage error."
  );
}
