/**
 * The one seam every briefing-form case reads the schema through: parse a form and list what it refused.
 *
 * The exact message is asserted, not a fragment, because the message is the contract with a machine caller
 * filling this form — it has to say what to do next.
 */
import { briefingFormSchema } from "../../../../../outbound/briefing/schema.js";

/** An issue's path as a refusal names it — one on the form itself, which has no segments, reads as `form`. */
function pathLabel({ path }: { path: readonly PropertyKey[] }): string {
  const joined = path.join(".");
  if (joined === "") {
    return "form";
  }
  return joined;
}

/**
 * Every refusal the schema produced, as `path: message`, in order.
 *
 * @returns each issue as one line, empty when the form parses
 */
export function refusals({ form }: { form: unknown }): readonly string[] {
  const parsed = briefingFormSchema.safeParse(form);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${pathLabel({ path: issue.path })}: ${issue.message}`);
}
