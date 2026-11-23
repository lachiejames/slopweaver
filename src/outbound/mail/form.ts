/**
 * The typed form every mail door's `draft` composes from — the one shape a mail body may arrive in, for
 * `gmail draft` and `outlook draft` alike.
 *
 * ## Why a form on stdin rather than `--to`/`--subject`/`--body` flags
 *
 * A body is prose, and prose on a command line goes through a shell. Backticks are substituted, `$` is
 * expanded, and quoting rules differ between the shells an agent might be running under — this repository
 * has already had a journal entry silently eaten mid-sentence by exactly that. `--form -` reads bytes, so
 * what the author wrote is what gets composed. It is also how the Slack outbound lane already takes a
 * message, which means one convention rather than two.
 *
 * ## Strict, per the outbound-form ratchet
 *
 * Built with {@link ../strictForm.strictForm}, so an unrecognised key is REFUSED and the refusal names the
 * nearest real field. The failure that rule exists for is a payload ported from another system whose keys
 * were silently dropped, leaving a message that sent with its substance missing. A form carrying
 * `recipients` instead of `to` should not compose an empty mail — it should stop and say which field it
 * meant.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { strictForm } from "../strictForm.js";

/** A composed message, before any provider has seen it. */
export interface MailComposeForm {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly body: string;
}

/**
 * A recipient list that accepts a single string as well as an array, because writing one address as a bare
 * string is what everybody does and refusing it teaches nothing.
 */
const recipients = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return [];
    } else if (typeof value === "string") {
      return [value];
    } else {
      return value;
    }
  });

/** The compose form's schema — strict, so an unrecognised key is refused rather than dropped. */
const mailComposeFormSchema = strictForm({
  bcc: recipients,
  body: z.string(),
  cc: recipients,
  subject: z.string(),
  to: recipients,
});

/**
 * Where in the form one validation issue sits, as a dotted key path. Zod gives an issue about the document as
 * a whole — JSON that is not an object, say — an empty path, and that is the form's root.
 */
function issueLocation({ path }: { path: readonly PropertyKey[] }): string {
  const dotted = path.join(".");
  if (dotted.length === 0) {
    return "(root)";
  }
  return dotted;
}

/**
 * Parse and validate the JSON a caller supplied for a mail door's `draft --form`.
 *
 * Shape only: this reports a malformed document and an unrecognised or mistyped key, and hands the body back
 * byte for byte. Whether the addresses are deliverable-looking, whether there is at least one of them, and
 * whether the body is hard-wrapped inside a paragraph is {@link ../../live/gmail/compose.validateComposeForm}'s
 * job, and it stays there because it is the same question whether a form arrived as JSON or was assembled
 * some other way.
 *
 * @param json the raw text of the form, exactly as it arrived on stdin or in the flag
 * @returns the parsed form, or every reason it was refused
 */
export function parseMailComposeForm({ json }: { json: string }): Result<MailComposeForm> {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch (cause) {
    return err([`--form is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
  const parsed = mailComposeFormSchema.safeParse(document);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issueLocation({ path: issue.path })}: ${issue.message}`));
  }
  return ok({
    bcc: parsed.data.bcc,
    body: parsed.data.body,
    cc: parsed.data.cc,
    subject: parsed.data.subject,
    to: parsed.data.to,
  });
}
