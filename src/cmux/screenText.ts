/**
 * Decoding a `surface.read_text` reply — the screen-text half of `CmuxClient.readScreen` (`./client.ts`), split out
 * the way `./renderGrid.ts` holds `readScreenGrid`'s.
 *
 * Pure: a decoded reply in, the text or a typed failure out.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CmuxError, CmuxErrors } from "./errors.js";
import { nonEmptyString } from "./workspaceRow.js";

/**
 * Pull the screen text out of a `surface.read_text` reply.
 *
 * cmux answers with `text` when it can and `base64` when the rendered grid carries bytes it will not put in a
 * JSON string — measured both ways on the same build, which is why this handles both rather than picking the
 * one the first call happened to return.
 *
 * @param value the decoded reply
 * @returns the screen text, or the typed failure
 */
export function parseScreenText({ value }: { value: unknown }): Result<string, CmuxError> {
  const text = nonEmptyString({ field: "text", value });
  if (text !== undefined) {
    return ok(text);
  }
  const base64 = nonEmptyString({ field: "base64", value });
  if (base64 !== undefined) {
    return ok(Buffer.from(base64, "base64").toString("utf8"));
  }
  return err(
    CmuxErrors.malformedReply({ detail: "the reply carried neither `text` nor `base64`", method: "surface.read_text" }),
  );
}
