/**
 * The form rules a quote proof slot is held to beyond its schema: how much output it may carry, and that it carries
 * no reader's address. Read by `./formRules.ts`, so the write door and CI apply them as one list with the rest.
 */
import { carriesPii } from "../slack/piiRedaction.js";
import type { FormRuleIssue } from "./formRules.js";
import type { PrBody } from "./types.js";

/**
 * The most lines a quote holds, and the widest one: the lines that prove the point, never the whole log. Twenty is
 * the failing-step tail `github run-log` prints (`skills/github/reference/job-logs.md`); 200 characters is a design
 * bound, not a measurement. Refused rather than truncated, because a trimmed quote is no longer verbatim.
 */
export const QUOTE_CAPS = { lineChars: 200, lines: 20 } as const;

/**
 * A quote past {@link QUOTE_CAPS}, or carrying an email or IP address. A quote is the one cell no prose rule reads,
 * since it is somebody else's output, and a raw log is the likeliest place for a reader's address to sit; GitHub's
 * write path redacts neither, so the form refuses it rather than publishing it or rewriting the quote.
 *
 * @param body the body whose two proof slots are read
 * @returns one issue per broken rule per quoted slot, none for a screenshot or a reason
 */
export function quoteIssues({ body }: { body: PrBody }): readonly FormRuleIssue[] {
  return (["problemProof", "solutionProof"] as const).flatMap((field): FormRuleIssue[] => {
    const slot = body[field];
    if (slot.kind !== "quote") {
      return [];
    }
    const issues: FormRuleIssue[] = [];
    const lines = slot.text.split("\n");
    // A reduce, never a spread into Math.max: a spread passes every line as an argument and overflows the stack.
    const widest = lines.reduce((most, line) => Math.max(most, Array.from(line).length), 0);
    if (lines.length > QUOTE_CAPS.lines || widest > QUOTE_CAPS.lineChars) {
      issues.push({
        code: "QUOTE_LINES",
        message:
          `${field}.text is ${String(lines.length)} lines, the widest ${String(widest)} characters (max ` +
          `${String(QUOTE_CAPS.lines)} lines of ${String(QUOTE_CAPS.lineChars)}). Quote only the lines that prove ` +
          "it; the source line points at the rest",
        path: [field, "text"],
      });
    }
    if (carriesPii({ text: slot.text })) {
      issues.push({
        code: "QUOTE_PII",
        message:
          `${field}.text carries an email or IP address, which a pull request would publish as is. Quote lines ` +
          "without one, or replace it with a placeholder such as [email] or [ip] and say so in the proves line",
        path: [field, "text"],
      });
    }
    return issues;
  });
}
