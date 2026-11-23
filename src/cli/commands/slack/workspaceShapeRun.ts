/**
 * The three shell helpers `slack channel`, `slack dm` and `slack canvas` share.
 *
 * Shared rather than copied because each of the three is one small deviation away from being wrong in a
 * way no test would see: a door refusal that prints its findings but returns `EXIT_OK` reads as a
 * successful create, and a `--markdown` read that swallows its own error reads as an empty document. One
 * implementation of each keeps the three verbs answering identically.
 *
 * These verbs are grouped as WORKSPACE-SHAPE rather than as sends: none of them posts a message, all three
 * change what the workspace contains, and each one's retraction is weaker than a send's (a channel can only
 * be archived, a DM cannot be closed for the other person, and a canvas has to be explicitly deleted).
 */
import { readFile } from "node:fs/promises";

import { notPerformedLines } from "../../../admit/doorRefusal.js";
import type { ThroughDoorResult } from "../../../admit/effects.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { type SlackArgumentError, slackArgumentErrorLines } from "./argumentErrors.js";
import { type SlackRead, SlackReadErrors } from "./readErrors.js";

/**
 * Print a list of rejections and return the usage exit code.
 *
 * @param errors the rejections, all of them — these parsers accumulate rather than short-circuit
 * @returns the usage exit code
 */
export function usageExit({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  return EXIT_USAGE;
}

/**
 * Print a typed argument refusal, one line per problem, and return the usage exit code — the one way all three
 * verbs report an invocation their parser refused.
 *
 * @param error the parser's refusal, every problem it pooled
 * @returns the usage exit code
 */
export function argumentUsageExit({ error }: { error: SlackArgumentError }): number {
  return usageExit({ errors: slackArgumentErrorLines({ error }) });
}

/**
 * Report a door refusal, or hand back what the performed effect returned.
 *
 * A refusal is `EXIT_ERROR` rather than an "expected empty" code, which is a deliberate split from the send
 * verbs: a refused SEND usually means "this exact message already went out", which is a benign outcome a
 * script should not treat as failure. A refused CREATE means the thing the caller asked for does not exist,
 * and a script that carries on to reference it will fail later and further away.
 *
 * @param command the invocation the refusal names, so a reader is told to re-run what they actually ran —
 *   every caller shared `slopweaver slack workspace-shape` before this was a parameter, which is how a
 *   `slack canvas` refusal came to instruct the reader about a verb they had not typed
 * @param routed what `throughDoor` decided and, when it passed, what the effect returned
 * @param nothingHappened the one line that says what was NOT done, in this verb's own words
 * @returns the process exit code
 */
export function doorOutcome({
  command,
  routed,
  nothingHappened,
}: {
  command: string;
  routed: ThroughDoorResult<number>;
  nothingHappened: string;
}): number {
  if (routed.performed) {
    return routed.result;
  }
  for (const line of notPerformedLines({ command, through: routed })) {
    logger.error({ msg: line });
  }
  logger.error({ msg: nothingHappened });
  return EXIT_ERROR;
}

/**
 * The document behind a `--markdown <file|->` flag.
 *
 * An unreadable path becomes a REJECTION rather than an empty string, and that is the whole reason this is
 * a function. `readFile` throwing into a `catch` that returns `""` produces a create that succeeds and
 * mints a blank canvas in a real workspace — the author's typo turned into a document.
 *
 * @param source the flag value: a path, or `-` for stdin
 * @param stdinSentinel the token that means stdin for this verb
 * @returns the document text, or the one rejection to print
 */
export async function readMarkdownSource({
  source,
  stdinSentinel,
}: {
  source: string;
  stdinSentinel: string;
}): Promise<SlackRead<string>> {
  if (source === stdinSentinel) {
    return ok(await readStdin());
  }
  try {
    return ok(await readFile(source, "utf8"));
  } catch (error) {
    return err(SlackReadErrors.markdownUnreadable({ reason: errorMessage({ error }), source }));
  }
}
