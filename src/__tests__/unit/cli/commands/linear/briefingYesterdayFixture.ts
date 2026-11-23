/**
 * Yesterday's briefing bundle for the `linear briefing` tests: the parsed form, the step files its plan writes,
 * and the witness URLs an apply-all records against them. Builders only, so every assertion stays in the test file.
 */
import { parseLinearBriefingForm } from "../../../../../cli/commands/linear/briefingCore.js";
import { unwrap } from "../../../../../lib/result.js";
import { BRIEFING } from "../../../outbound/linear/briefingFixture.js";

/**
 * Yesterday's briefing: same items, composed at the instant today's reads from. Parsed, as `build` stores it — a
 * certificate is judged by re-planning the parsed form, and the planner keeps the form's own key order.
 */
export const YESTERDAY = unwrap(
  parseLinearBriefingForm({
    raw: JSON.stringify({ ...BRIEFING, asOfIso: BRIEFING.evidenceSinceIso!, evidenceSinceIso: null }),
  }),
);

/** Every step file yesterday's bundle planned, in apply order. */
export const YESTERDAY_STEPS = [
  "forms/01-eng-9-backlog-move.json",
  "forms/02-eng-3-superseded-comment.json",
  "forms/02-eng-3-superseded-relation.json",
  "forms/02-eng-3-superseded-move.json",
  "forms/03-eng-7-comment-comment.json",
  "forms/04-alpha-update-project-update.json",
];

/**
 * One witness URL per step file.
 *
 * @param files the step files an apply-all witnessed
 * @returns each file mapped to its own synthetic Linear issue URL
 */
export function witnessesFor({ files }: { files: readonly string[] }): Record<string, string> {
  return Object.fromEntries(files.map((file, index) => [file, `https://linear.app/x/issue/ENG-${String(index)}`]));
}
