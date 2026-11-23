/**
 * How `worktree prune` runs a git command that changes something, and reads git's refusal when it will not.
 *
 * Split out of `pruneApply.ts` when that file passed the size ratchet, so the tree removal and the branch
 * deletion (`./pruneBranchDelete.ts`) share one runner: hooks off, the strict stat, background priority.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "../lib/gitRepo.js";
import { STRICT_STAT } from "./pruneGit.js";
import { lowPriorityArgv } from "./prunePacing.js";
import { HOOKS_OFF } from "./salvagePush.js";

/** Removing a checkout of tens of thousands of files, with room for a slow disk. */
export const REMOVE_TIMEOUT_MS = 600_000;

/** Enough for git's own progress and error output on a large tree. */
export const REMOVE_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * The line of git's stderr that says WHY, out of everything it printed.
 *
 * Git follows a refusal with one or more `hint:` lines, and the last of them is usually the one about
 * turning the hint off. Taking the last line therefore reported `hint: Disable this message with "git config
 * set advice.forceDeleteBranch false"` as the reason a branch was kept — measured on a live run,
 * on every one of thirteen squash-merged branches. The reason is the first `error:`/`fatal:` line.
 *
 * Pure, so the exact stderr git produced that night is a fixture rather than something to reproduce.
 *
 * @param stderr everything git wrote to stderr
 * @returns the decisive line, or an empty string when git said nothing
 */
export function refusalLine({ stderr }: { stderr: string }): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  const decisive = lines.find((line) => line.startsWith("error:") || line.startsWith("fatal:"));
  if (decisive === undefined) {
    return lines[0]!;
  }
  return decisive;
}

/**
 * Run a git command that changes something, with the repository's hooks off.
 *
 * @param args git's arguments, after the armour this adds
 * @param cwd where git runs
 * @param stdin fed to git when given, as `update-ref --stdin` reads its transaction
 * @returns `null` on success, or git's own message on refusal
 */
export function refusalOf({
  args,
  cwd,
  stdin,
}: {
  args: readonly string[];
  cwd: string;
  stdin?: string;
}): string | null {
  try {
    // `git worktree remove` runs its own dirty check, so it reads through the same strict stat as every re-read. At
    // background priority, because the removal deletes every tracked file and build output (`./prunePacing.ts`).
    const [command, ...argv] = lowPriorityArgv({
      argv: ["git", ...HOOKS_OFF, ...STRICT_STAT, ...args],
      platform: process.platform,
    });
    execFileSync(command!, argv, {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      ...(stdin === undefined ? {} : { input: stdin }),
      maxBuffer: REMOVE_MAX_BUFFER,
      stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "pipe"],
      timeout: REMOVE_TIMEOUT_MS,
    });
    return null;
  } catch (error: unknown) {
    const raw = error instanceof Error ? Reflect.get(error, "stderr") : undefined;
    let stderr: string;
    if (typeof raw === "string") {
      stderr = raw;
    } else if (Buffer.isBuffer(raw)) {
      stderr = raw.toString("utf8");
    } else {
      stderr = "";
    }
    const reason = refusalLine({ stderr });
    return reason.length > 0 ? reason : `git ${args.join(" ")} failed or was interrupted`;
  }
}
