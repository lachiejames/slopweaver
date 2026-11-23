/**
 * Decoding a pull-request form and an update edit from the JSON a caller hands `github pr update` or
 * `github stack push`. Pure: the text is read by the caller, and every violation comes back at once.
 */
import type { z } from "zod";
import { err, ok, type Result } from "../../../lib/result.js";
import { prFormEditSchema } from "../../../outbound/github/schema.js";
import type { PrFormDraft, PrFormEdit } from "../../../outbound/github/types.js";
import { prFormWriteSchema } from "../../../outbound/github/writeSchema.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

/** Render Zod issues as `path: message`, which is what a machine caller can act on. */
function zodErrors({ error }: { error: z.ZodError }): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((p) => String(p)).join(".");
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}

/**
 * Parse and validate a whole form — a create's, or a whole-replacement update's.
 *
 * @param raw the JSON text
 * @returns the validated draft, or every violation
 */
export function parsePrForm({ raw }: { raw: string }): Result<PrFormDraft, GithubVerbError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err(GithubVerbErrors.flagNotJson({ cause, flag: "--form" }));
  }
  const result = prFormWriteSchema.safeParse(parsed);
  if (!result.success) {
    return err(GithubVerbErrors.formInvalid({ form: "--form", reasons: zodErrors({ error: result.error }) }));
  }
  return ok(result.data);
}

/**
 * Parse an update edit, decoding it STRICTLY.
 *
 * Every field is optional, because an edit names only what changes — but an UNDECLARED field is refused by
 * name. It used to be tolerated, and that was a silent-success bug rather than a convenience: `applyEdit`
 * reads only the keys it knows, so a misspelt key changed nothing, PATCHed an unchanged body and reported
 * `updated`. Partiality is about which fields are required; it never justified accepting a typo. The schema
 * also refuses an edit that both sets and removes a field, or both sets and appends to one.
 *
 * The merged form is STILL re-validated in `./updateFlow.ts` before rendering, because an edit that is valid
 * alone can produce an over-length cell once merged. Both checks are needed and neither replaces the other.
 *
 * @param raw the JSON text
 * @returns the edit, or every violation at once
 */
export function parsePrEdit({ raw }: { raw: string }): Result<PrFormEdit, GithubVerbError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err(GithubVerbErrors.flagNotJson({ cause, flag: "--edit" }));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(GithubVerbErrors.editNotObject({ got: raw }));
  }
  const decoded = prFormEditSchema.safeParse(parsed);
  if (!decoded.success) {
    return err(GithubVerbErrors.formInvalid({ form: "--edit", reasons: zodErrors({ error: decoded.error }) }));
  }
  return ok(decoded.data);
}
