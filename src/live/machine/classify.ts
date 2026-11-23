/**
 * Whose side a process is on — this checkout's own agent fleet, or unrelated machine activity.
 *
 * A leaf on purpose. It was one function inside `./capacity.ts` until `./cpuHogs.ts` needed the same
 * judgement, and `capacity.ts` needs `cpuHogs.ts`'s reading for its own report — so leaving it there would
 * have made the two files import each other. One criterion, one home, no cycle.
 */

/** An argv naming the CLI's own binary, a worktree of this checkout, or the cmux app — the "fleet" itself. */
const FLEET_ARGV_PATTERN = /\bclaude\b|cmux|slopweaver/iu;

/** Whether a process belongs to this checkout's own agent fleet, or is unrelated machine activity. */
export type ProcessClassification = "fleet" | "foreign";

/**
 * Classify one process by its own argv: this checkout's `claude` binary, a `node` running under a
 * slopweaver worktree, or the cmux app are "fleet"; everything else — including a process this machine
 * cannot even name, when no `ps` row joined to it — is "foreign". Every caller first asks whether a live
 * session OWNS the process, which makes anything a session spawned fleet whatever its argv says.
 *
 * @param argv the process's full command line, or `undefined` when no `ps` row matched its pid
 * @returns the classification
 */
export function classifyProcess({ argv }: { argv: string | undefined }): ProcessClassification {
  return argv !== undefined && FLEET_ARGV_PATTERN.test(argv) ? "fleet" : "foreign";
}
