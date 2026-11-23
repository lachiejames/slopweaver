/**
 * The JSON-then-schema sequence every `slopweaver linear` write verb runs over its `--form`, written once: a
 * form that is not JSON at all is `FORM_NOT_JSON`, and one that is JSON but not the verb's shape is
 * `FORM_INVALID`, carrying one `path: message` line per schema issue.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

/**
 * Parse a form's raw text as JSON, then validate it against the verb's own schema.
 *
 * @param raw the JSON text of the form
 * @param schema the verb's form schema, as far as this reads one
 * @returns the typed form, or the refusal naming why it is not one
 */
export function parseLinearForm<T>({
  raw,
  schema,
}: {
  raw: string;
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
  };
}): Result<T, LinearVerbError> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err(LinearVerbErrors.formNotJson({ cause: error }));
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? ok(parsed.data) : err(LinearVerbErrors.formInvalid({ issues: parsed.error.issues }));
}
