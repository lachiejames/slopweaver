/**
 * The protection-read failure a fake GitHub API answers for a method its test never reaches. A protection read
 * fails with its own typed union (`corpus/github/protectionRead.ts`), never a bare boundary error, so a fake built
 * for one has to be built through the same factory the real read uses.
 */
import { type GithubProtectionReadError, GithubProtectionReadErrors } from "../corpus/github/protectionRead.js";

/** A protection read that failed for no reason a test asserts on: the unreached-method answer. */
export const UNREACHED_PROTECTION_READ: GithubProtectionReadError = GithubProtectionReadErrors.readFailed({
  branch: "main",
  cause: { kind: "http", message: "unreachable", operation: "x" },
});
