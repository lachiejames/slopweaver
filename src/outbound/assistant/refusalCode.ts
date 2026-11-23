/**
 * The error code of a refused `assistant.threads.*` call — the one reading `./status.ts` and `./title.ts` share,
 * because both turn every body that is not `ok: true` into a refusal and both name it by this code.
 */
import { isRecord } from "#lib/parsers.js";

/** The code a refusal carries when its body names none of Slack's own. */
const UNREADABLE_RESPONSE = "unreadable_response";

/**
 * The code Slack gave for a refused `assistant.threads.*` call, or `unreadable_response` when the body names none.
 *
 * Slack puts a non-empty `error` on every refusal it writes, so a body without one is not a JSON object at all, or
 * not one Slack wrote, and the code says exactly THAT rather than inventing a Slack code. Either way the caller
 * still refuses: "I could not tell" never reads as "it worked".
 *
 * @param body the raw response body, already known not to be a success
 * @returns Slack's own error code, or `unreadable_response` for a body that carries none
 */
export function assistantRefusalCode({ body }: { body: unknown }): string {
  if (!isRecord(body)) {
    return UNREADABLE_RESPONSE;
  }
  const error = body["error"];
  if (typeof error !== "string" || error.length === 0) {
    return UNREADABLE_RESPONSE;
  }
  return error;
}
