/**
 * What one `admitSetupToken` concluded, as the lines a reader sees and the exit code — shared by `claude mint`
 * and `claude token`, the two verbs that admit a setup token, so the verdict reads the same whichever one
 * proved it.
 *
 * The verb's own name stays outside: a problem goes through the caller's `writeProblem`, which owns the
 * `claude mint:` / `claude token:` prefix, and this module never knows which verb it is reporting for.
 */
import type { Result } from "#lib/result.js";

import type { ClaudeRotationError } from "../../../claude/errors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/**
 * Print what one admission concluded and turn it into the exit code. An UNPROVEN token's judge lines are the
 * verb's output, so they go to `writeOut`; any other failure is a problem for `writeProblem`; an admitted token
 * prints the judge's lines and then where it was written.
 *
 * @param account the plan the token was offered for — its alias names the plan in the closing line
 * @param admitted the admitted token's lines and path, or why there is none
 * @param writeOut prints one line of the verb's output
 * @param writeProblem reports one problem through the verb's own complaint channel
 * @returns `EXIT_OK` once the token was written, `EXIT_ERROR` otherwise
 */
export function reportSetupTokenAdmission({
  account,
  admitted,
  writeOut,
  writeProblem,
}: {
  account: { readonly alias: string };
  admitted: Result<{ readonly lines: readonly string[]; readonly path: string }, ClaudeRotationError>;
  writeOut: (input: { line: string }) => void;
  writeProblem: (input: { problem: string }) => void;
}): number {
  if (admitted.isErr()) {
    if (admitted.error.code === "SETUP_TOKEN_UNPROVEN") {
      for (const line of admitted.error.lines) {
        writeOut({ line });
      }
    } else {
      writeProblem({ problem: admitted.error.message });
    }
    return EXIT_ERROR;
  }
  for (const line of admitted.value.lines) {
    writeOut({ line });
  }
  writeOut({
    line: `${account.alias}: written to ${admitted.value.path} — every spawn routed to ${account.alias} now boots on it`,
  });
  return EXIT_OK;
}
