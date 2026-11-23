/**
 * The checkout-reading half of `codex plugin-sync`: which checkout may publish the Codex install, and which
 * commit it would publish. Reads git and the filesystem only; `./sync.ts` does every write.
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { gitEnv } from "#lib/gitRepo.js";
import { err, ok, type Result } from "#lib/result.js";

import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";

/** Bound on each external step, so a wedged `git` or `codex` cannot hold a background run forever. */
export const STEP_TIMEOUT_MS = 120_000;

/**
 * Run git in the checkout with the hook-exported variables removed, so `cwd` decides the repository.
 *
 * @param cwd the checkout to run in
 * @param args git's arguments
 * @returns git's trimmed stdout; a failed git throws
 */
export function git({ cwd, args }: { cwd: string; args: readonly string[] }): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: STEP_TIMEOUT_MS,
  }).trim();
}

/** The branch `origin/HEAD` names (`main`, not `origin/main`), or undefined when origin/HEAD is unset. */
function originDefaultBranch({ cwd }: { cwd: string }): string | undefined {
  try {
    return git({ args: ["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd }).replace(/^origin\//u, "");
  } catch {
    return undefined;
  }
}

/**
 * Whether `checkout` is one of the declared main checkouts, compared by real path.
 *
 * @param checkout the git toplevel the verb runs in
 * @param mainCheckouts the profile's declared main checkout paths
 * @returns true when one of them is the same directory
 */
export function isDeclaredMain({
  checkout,
  mainCheckouts,
}: {
  checkout: string;
  mainCheckouts: readonly string[];
}): boolean {
  const real = realpathSync(checkout);
  return mainCheckouts.some((path) => existsSync(path) && realpathSync(path) === real);
}

/**
 * The checkout's HEAD when it sits on origin's default branch — a main checkout on a side branch never publishes.
 *
 * @param checkout the git toplevel the verb runs in
 * @returns the commit to publish, a skip naming why not, or why git could not be read
 */
export function publishableHead({
  checkout,
}: {
  checkout: string;
}): Result<{ readonly head: string } | { readonly skip: string }, CodexPluginSyncError> {
  let head: string;
  let branch: string;
  try {
    head = git({ args: ["rev-parse", "HEAD"], cwd: checkout });
    branch = git({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: checkout });
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.exportFailed({ detail: errorMessage({ error }) }));
  }
  const defaultBranch = originDefaultBranch({ cwd: checkout });
  if (defaultBranch === undefined) {
    return ok({
      skip: `${checkout} has no origin/HEAD, so its default branch is unknown — run \`git remote set-head origin --auto\``,
    });
  }
  if (branch !== defaultBranch) {
    return ok({ skip: `${checkout} is on ${branch}, not ${defaultBranch}, and only the default branch publishes` });
  }
  return ok({ head });
}
