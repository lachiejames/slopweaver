/**
 * The lines `handover start` prints once a run has opened: the doc's summary preview and the self-executing NEXT
 * line. Pure, and apart from `./lifecycle.ts`'s gates and writes, so the recap a session reads is testable
 * without a journal.
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import { type ProbeResult, probeMark } from "../../../handover/probe.js";

/** How much of a doc's `summary:` `start`'s recap line shows before truncating, in Unicode code points. */
const START_SUMMARY_PREVIEW_CODE_POINTS = 160;

/**
 * A doc's `summary:` collapsed to one line and capped, so a session's own recap of `handover start` carries the
 * task rather than the most-salient-but-meaningless probe count — measured: three spawned sessions
 * read "0 probe(s) to satisfy" as "nothing specified" and asked the owner what the run covered, even though the
 * doc on disk was complete every time.
 *
 * @param summary the doc's already-parsed `summary:` frontmatter field
 * @returns the one-line preview, or `undefined` when the doc names no summary
 */
function startSummaryLine({ summary }: { summary: string | undefined }): string | undefined {
  if (summary === undefined) {
    return undefined;
  }
  const collapsed = summary.replace(/\s+/gu, " ").trim();
  // oxlint-disable-next-line no-misused-spread
  const points = [...collapsed];
  if (points.length <= START_SUMMARY_PREVIEW_CODE_POINTS) {
    return collapsed;
  }
  return `${points.slice(0, START_SUMMARY_PREVIEW_CODE_POINTS).join("")}…`;
}

/**
 * The exact lines `handover start` prints once a run has actually opened — pure, so the self-executing NEXT
 * line and the doc's summary preview are unit-testable without a real journal write.
 *
 * Measured: three spawned sessions in 24h ran `handover start`, saw the bare probe count, read "0
 * probe(s) to satisfy" as "nothing specified", and asked the owner what the task was — even though the doc on
 * disk was complete every time. The summary line and the NEXT line exist so the recap a session reads carries
 * the task instead of the most-salient-but-meaningless number.
 *
 * @param doc the doc a run was just opened for
 * @param branch the branch this run's commits will land on
 * @param journalPath the journal file the `started` event was appended to
 * @param results the probes evaluated against this doc right now
 * @param inheritedQuestion the question the previous cycle closed still holding, reaped or started over, which this run opens
 * waiting on — the NEXT line then says so, because a session told only to execute the doc would walk past it
 * @returns the lines to print, in order
 */
export function startOpenedLines({
  doc,
  branch,
  journalPath,
  results,
  inheritedQuestion,
}: {
  doc: HandoverDoc;
  branch: string;
  journalPath: string;
  results: readonly ProbeResult[];
  inheritedQuestion: string | undefined;
}): readonly string[] {
  const summaryLine = startSummaryLine({ summary: doc.summary });
  if (inheritedQuestion !== undefined) {
    return [
      `handover start: opened a run for ${doc.slug} on ${branch}, WAITING ON THE OWNER`,
      ...(summaryLine === undefined ? [] : [`  summary: ${summaryLine}`]),
      `  journal: ${journalPath}`,
      `  doc:     ${doc.path}`,
      "",
      "  NEXT: the previous cycle closed holding an unanswered question, and neither a dead session nor a " +
        "re-start is an answer. Do not proceed — the question is:",
      `    ${inheritedQuestion}`,
      `  Record the owner's answer with \`slopweaver handover answer ${doc.slug} --answer "<their words>"\`, or withdraw it if resolved.`,
    ];
  }
  return [
    `handover start: opened a run for ${doc.slug} on ${branch}`,
    ...(summaryLine === undefined ? [] : [`  summary: ${summaryLine}`]),
    `  journal: ${journalPath}`,
    `  doc:     ${doc.path}`,
    `  ${String(results.length)} probe(s) to satisfy:`,
    ...results.map((result) => `  ${probeMark({ outcome: result.outcome })} ${result.note}`),
    "",
    `  NEXT: read the doc at ${doc.path} in full and execute it. 0 probes means probes are unregistered — ` +
      "register real doneWhen probes as soon as the work's shape is known. Never ask the owner what this run " +
      "covers.",
  ];
}
