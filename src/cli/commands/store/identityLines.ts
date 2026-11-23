/**
 * What `store identity` prints about one reconcile — the people written, the members skipped and why, the
 * rows re-pointed, the people renamed in place. Pure rendering over a {@link ReconcileReport}; `identityArgs.ts`
 * parses the invocation and `run.ts` runs it.
 */
import type { ReconcileReport } from "../../../store/identity/reconcile.js";

/**
 * The line saying how many people the directory id followed to a new primary address, or none when nobody's
 * address changed — the common run, where a zero line would only be noise.
 *
 * @param report what the run did
 * @returns zero or one line
 */
function followedLines({ report }: { report: ReconcileReport }): readonly string[] {
  if (report.renamed === 0) {
    return [];
  }
  return [
    `${String(report.renamed)} person row(s) renamed in place to the new primary address their Google id now carries, keeping their history`,
  ];
}

/**
 * Render what a reconcile did: where the people came from, what was skipped and why, and how many rows
 * now point at a person.
 *
 * The bot count is reported beside the people rather than buried, because it is the number that says the
 * shape is doing its job: a bot never becomes a person, and a run that suddenly skipped far fewer would
 * mean a platform had stopped flagging them. Every refusal is printed in full — each names an id the
 * schema would have refused, so it is the evidence, not noise.
 *
 * @param report what the run did
 * @returns the lines to print
 */
export function identityLines({ report }: { report: ReconcileReport }): readonly string[] {
  const lines = [
    `${String(report.people)} person(s) written from ${String(report.directoryUsers)} directory user(s) and ${String(report.membersRead)} member row(s) in ${String(report.elapsedMs)} ms`,
    `${String(report.fromDirectory)} keyed by Google Admin, ${String(report.people - report.fromDirectory)} by a trusted address Google does not hold (departed, contractor or guest — kept, never forgotten)`,
    `${String(report.bots)} bot member(s) skipped: a bot is never a person, its id stays on the content row`,
    `${String(report.candidates - report.accepted)} name candidate(s) recorded for review, never applied; ${String(report.accepted)} exact org-member name(s) linked; ${String(report.unmatched)} member(s) with no address and no close name`,
    `${String(report.authorsRepointed)} content row(s) re-pointed at a person; ${String(report.pruned)} stale person row(s) pruned, none of them an author of anything`,
    ...followedLines({ report }),
    ...report.refused.map((line) => `  refused: ${line}`),
  ];
  return report.warnings.length === 0 ? lines : [...lines, ...report.warnings.map((warning) => `  ${warning}`)];
}
