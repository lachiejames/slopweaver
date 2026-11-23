/**
 * Why a git READ run by `worktree.ts`'s `runGit` failed, as one line — here rather than in that file so the reason
 * is pure and testable without a git or a missing directory.
 */

import { existsSync } from "node:fs";

import { isRecord } from "../lib/parsers.js";

/**
 * The error `runGit` throws for what `execFileSync` threw: git's own stderr when it spoke, else the reason it
 * never started.
 *
 * @param args the git argv that failed
 * @param cwd the directory git was asked to run in
 * @param error what `execFileSync` threw
 * @returns the error to throw, carrying the original as its cause
 */
export function gitReadError({ args, cwd, error }: { args: readonly string[]; cwd: string; error: unknown }): Error {
  const stderr = isRecord(error) ? error["stderr"] : undefined;
  let detail: string;
  if (typeof stderr === "string") {
    detail = stderr;
  } else if (Buffer.isBuffer(stderr)) {
    detail = stderr.toString("utf8");
  } else {
    detail = "";
  }
  const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(describeGitReadFailure({ args, code, cwd, cwdExists: existsSync(cwd), message, stderr: detail }), {
    cause: error,
  });
}

/**
 * The one-line reason a git READ failed, naming the cause whether git spoke or never started.
 *
 * MEASURED: a board row carrying `repo: slopweaver` — a bare name, not a path — made a
 * seat run `git worktree list --porcelain` with that name as its cwd. Node refuses to start a child in a
 * missing directory and throws `{ code: "ENOENT", message: "spawnSync git ENOENT", stderr: undefined }`, so
 * the old message ended at "failed" with nothing after it, and Node's own words would have blamed a missing
 * `git` rather than the directory. The listing ran in 0.27s from the real checkout.
 *
 * @param args the git argv that failed
 * @param cwd the directory git was asked to run in
 * @param cwdExists whether that directory exists — the one fact that tells a missing cwd from a missing git
 * @param stderr everything git wrote to stderr, empty when it never started
 * @param code Node's error code when the child could not be started (`ENOENT`, `ETIMEDOUT`), else undefined
 * @param message the thrown error's own message, kept for a start failure that is not a missing cwd
 * @returns the complete error message
 */
export function describeGitReadFailure({
  args,
  cwd,
  cwdExists,
  stderr,
  code,
  message,
}: {
  args: readonly string[];
  cwd: string;
  cwdExists: boolean;
  stderr: string;
  code: string | undefined;
  message: string;
}): string {
  const head = `git ${args.join(" ")} failed`;
  const detail = stderr.trim();
  if (detail.length > 0) {
    return `${head}: ${detail}`;
  }
  if (!cwdExists) {
    return (
      `${head}: its working directory ${cwd} does not exist — a row's repo: must be the absolute path of a ` +
      "checkout, never a bare name"
    );
  }
  if (code !== undefined) {
    return `${head}: ${code} (${message})`;
  }
  return head;
}
