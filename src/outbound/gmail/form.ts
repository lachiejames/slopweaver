/**
 * The typed form `gmail draft` composes from: the shared mail compose form (`../mail/form.ts`, which carries
 * the reasoning and the strict schema) under Gmail's own name.
 */
import type { Result } from "../../lib/result.js";
import type { GmailComposeForm } from "../../live/gmail/compose.js";
import { parseMailComposeForm } from "../mail/form.js";

/**
 * Parse and validate the JSON a caller supplied for `gmail draft --form`.
 *
 * @param json the raw text of the form, exactly as it arrived on stdin or in the flag
 * @returns the parsed form, or every reason it was refused
 */
export function parseGmailComposeForm({ json }: { json: string }): Result<GmailComposeForm> {
  return parseMailComposeForm({ json });
}
