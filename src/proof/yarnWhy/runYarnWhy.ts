/**
 * Running `yarn why <dependency>` directly (no Terminal window) to get its plain-text tree output, so the
 * resolved-version caption can be extracted from a real string rather than scraped off a screenshot.
 */
import { execFileSync } from "node:child_process";

/** How long a `yarn why` run may take before this is treated as a hung install rather than a slow one. */
const YARN_WHY_TIMEOUT_MS = 30_000;

/**
 * Run `yarn why <dependency>` in `worktree` and return its combined stdout/stderr text. Berry prints
 * either a tree or nothing (never a non-zero exit) when a dependency isn't in the lockfile, so failure
 * here means the worktree or the `yarn` binary itself is the problem, not a normal "not present" result.
 *
 * @param worktree the absolute worktree path to run the command in
 * @param dependency the dependency name to query
 * @param runFile the synchronous process runner; production runs the real `execFileSync`, a test passes a
 *   plain recording fake so no subprocess is launched
 * @returns the command's plain-text output
 */
export function runYarnWhyText({
  worktree,
  dependency,
  runFile = ({ file, args, options }) => execFileSync(file, args, { ...options, timeout: options.timeout }),
}: {
  worktree: string;
  dependency: string;
  runFile?: (call: {
    file: string;
    args: readonly string[];
    options: { cwd: string; encoding: "utf8"; timeout: number };
  }) => string;
}): string {
  return runFile({
    args: ["why", dependency],
    file: "yarn",
    options: { cwd: worktree, encoding: "utf8", timeout: YARN_WHY_TIMEOUT_MS },
  });
}
