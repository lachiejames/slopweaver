/**
 * One MANUAL `listen recover` pass, end to end: scan the named channels, narrate what could not be read,
 * print one document, return the exit code the pass's own coverage demands.
 *
 * Split out of `./recover.ts` so the flag handling there stays readable and this stays testable. Both output
 * sinks are ARGUMENTS rather than the ambient logger, which is what lets the unit lane drive the real
 * scan-to-exit-code path over a plain fake `SlackApi` — the original defect lived exactly in the
 * wiring between what the scan counted and what the verb printed, and a test of either half alone cannot
 * see it. The policy this consumes is pure and lives in `./manualRecoverReport.ts`.
 */
import type { Mention } from "../../../live/listen/mention.js";
import type { RecoveryReport } from "../../../live/listen/recover.js";
import { recoverSlackAsks } from "../../../live/listen/recoverScan.js";
import {
  type ManualRecoverOutput,
  manualRecoverExitCode,
  manualRecoverOutput,
  renderCoverage,
} from "./manualRecoverReport.js";

/**
 * Everything one manual sweep needs: the scanner's own options bag, the output flag, and the two sinks.
 *
 * The scan half is spelled as `recoverSlackAsks`'s own parameters rather than restated — listing its ten
 * fields here would be a second place for a new one to be forgotten, which is exactly how `cardEventType`
 * would once have gone missing. It is a named type rather than an inline intersection so `jsdoc-tags` can
 * enumerate the fields and a required one cannot hide behind a shape the scanner cannot read.
 */
export type ManualSweepArgs = Parameters<typeof recoverSlackAsks>[0] & {
  /** Whether to print the machine-readable document instead of the human report. */
  readonly json: boolean;
  /** Where a stdout line goes. */
  readonly out: (args: { line: string }) => void;
  /** Where a stderr line goes. */
  readonly error: (args: { msg: string }) => void;
};

/**
 * The exact, replayable `turn brief` command for one recovered mention — two lines, carrying the full
 * exact identity rather than reconstructing `--message-ts` from `--thread-ts` at replay time.
 *
 * `--turn-id`/`--working-ts` are appended only when `mention.started` exists — a capture checklist the
 * recovered ask's own ask-lifecycle entry already carried. An off-period ask (no listener was ever running
 * to post one) omits both, exactly as a live capture with no checklist already would.
 *
 * @param mention the recovered mention to replay
 * @returns the two command lines, in order
 */
export function briefReplayCommand({ mention }: { mention: Mention }): readonly [string, string] {
  const tail =
    mention.started === undefined
      ? ""
      : ` --turn-id ${mention.started.turnId} --working-ts ${mention.started.workingTs}`;
  return [
    `    slopweaver turn brief --channel ${mention.channel} --message-ts ${mention.messageTs} ` +
      `--thread-ts ${mention.threadTs} \\`,
    `      --user ${mention.userId} --surface ${mention.surface} --text ${JSON.stringify(mention.text)}${tail}`,
  ];
}

/**
 * Render the whole pass for a human reader — coverage first, then the findings.
 *
 * Coverage LEADS because the findings are only meaningful once a reader knows how much was read: an empty
 * `recoverable` under a partial pass means "I could not look", not "there is nothing".
 *
 * @param output the document this pass is about to print
 * @param report the scan's own classified report
 * @param sinceIso the window's cutoff, echoed so the reader knows what "scanned" covered
 * @returns the lines, in print order
 */
function renderReport({
  output,
  report,
  sinceIso,
}: {
  output: ManualRecoverOutput;
  report: RecoveryReport;
  sinceIso: string;
}): readonly string[] {
  const lines = [
    ...renderCoverage({ output }),
    `scanned ${String(report.verdicts.length)} message(s) since ${sinceIso}`,
    `  excluded: ${Object.entries(report.excludedBy)
      .map(([reason, count]) => `${reason} ${String(count)}`)
      .join(", ")}`,
    `  recoverable: ${String(report.recoverable.length)}`,
  ];
  for (const verdict of report.recoverable) {
    const mention = verdict.mention;
    if (mention === undefined) {
      continue;
    }
    lines.push(
      "",
      `UNANSWERED — ${mention.userId} in ${mention.channel} at ${verdict.candidate.tsIso}`,
      `  "${mention.text}"`,
      "  brief it:",
      ...briefReplayCommand({ mention }),
    );
  }
  return lines;
}

/**
 * Scan every named channel, classify, report.
 *
 * One unreadable channel must not sink the pass — a missing scope on a single channel is common and the
 * other channels' findings are still true. It is narrated per channel on stderr, COUNTED in the document,
 * and reflected in the exit code: a pass once made only the first of those three true, so a pass that
 * skipped most of its requested channels printed a document and an exit code identical to a clean one's.
 *
 * @param args the scan options, the output flag and both sinks
 * @returns the process exit code
 */
export async function sweep(args: ManualSweepArgs): Promise<number> {
  const { json, out, error, ...scan } = args;
  const result = await recoverSlackAsks(scan);
  const output = manualRecoverOutput({ scan: result });
  for (const excluded of output.excludedChannels) {
    error({ msg: `could not scan ${excluded.channel}: ${excluded.reason}` });
  }
  for (const failure of output.failures) {
    error({ msg: `could not scan ${subjectOf({ failure })}: ${failure.reason}` });
  }
  if (json) {
    out({ line: JSON.stringify(output, null, 2) });
  } else {
    for (const line of renderReport({ output, report: result.report, sinceIso: scan.sinceIso })) {
      out({ line });
    }
  }
  return manualRecoverExitCode({ output });
}

/** Which channel a coverage failure names, or the workspace when the failure was discovery-wide. */
function subjectOf({ failure }: { failure: ManualRecoverOutput["failures"][number] }): string {
  return failure.stage === "discovery" ? "the workspace" : failure.channel;
}
