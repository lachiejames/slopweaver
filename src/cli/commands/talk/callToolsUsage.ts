/**
 * The usage line of `talk call-tools` — a leaf importing nothing, so the `talk` manifest can quote it without loading
 * a parser (`.claude/rules/area-cli.md`).
 */

/** The usage `talk call-tools` prints. */
export const TALK_CALL_TOOLS_USAGE = [
  "usage: slopweaver talk call-tools --call <uuid> [--from <n>] [--limit <n>] [--home <dir>] [--json]",
  "       one call's tool lines with what the model was handed, secrets masked, oldest first; --from is the first row's",
  "       zero-based index (default 0), --limit how many rows (default 10, at most 50); page on until nextFrom is null",
].join("\n");
