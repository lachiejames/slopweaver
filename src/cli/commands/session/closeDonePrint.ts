/**
 * What one `session close-done` sweep did, and how it reads as text. The sweep itself is `./closeDone.ts`; this
 * file only renders its report, so the verb's own file stays the socket, the journal reads and the ledger writes.
 */
import type { SeatGoneEvent } from "../../../fleet/goneSeats.js";
import { logger } from "../../../lib/logger.js";
import {
  type CloseDoneOutcome,
  renderCloseDoneOutcome,
  renderCloseDoneSummary,
} from "../../../sessions/closeDoneOutcome.js";
import type { TrashSettled } from "../../../worktree/reclaimTrash.js";
import { type ResidueReport, renderResidueReport } from "../cmux/worktreeResidue.js";
import { renderGoneSeat } from "./closeDoneFleet.js";
import { printReclaim, type ReclaimReport } from "./closeDoneReclaim.js";
import { type CloseDoneShellOutcome, renderShellOutcome } from "./closeDoneShells.js";
import { renderTrash } from "./closeDoneTrash.js";

/**
 * What one sweep did: every row's outcome, the recovery seats it found gone, each finished resume tab, the residue
 * reap, the tree reclaim and the trash.
 */
export interface CloseDoneSwept {
  readonly outcomes: readonly CloseDoneOutcome[];
  /** The `seat-gone` lines journalled, or on a dry run the ones that would be. */
  readonly goneSeats: readonly SeatGoneEvent[];
  readonly shells: readonly CloseDoneShellOutcome[];
  readonly residue: ResidueReport;
  readonly reclaimed: ReclaimReport;
  /** The reclaim trash settle, or `null` on a dry run, which touches nothing. */
  readonly trash: TrashSettled | null;
}

/**
 * The summary line, with the finished resume tabs' count appended when the sweep met any.
 *
 * @param dryRun whether the sweep only reported, which the line's verb follows
 * @param swept what the sweep did
 * @returns the one summary line
 */
export function closeDoneSummary({ dryRun, swept }: { dryRun: boolean; swept: CloseDoneSwept }): string {
  const summary = renderCloseDoneSummary({ dryRun, outcomes: swept.outcomes });
  if (swept.shells.length === 0) {
    return summary;
  }
  const closed = swept.shells.filter((shell) => shell.kind === "closed").length;
  // Each tab left open says why on the summary itself: "closed 0 of 1" alone sent the chair to find the reason.
  const left = swept.shells.flatMap((shell) =>
    shell.kind === "closed" ? [] : [`${shell.workspaceRef} ${shell.kind}: ${shell.reason}`],
  );
  const why = left.length === 0 ? "" : ` — left ${left.join("; ")}`;
  return `${summary}; ${dryRun ? "would close" : "closed"} ${String(closed)} of ${String(swept.shells.length)} finished fleet resume tab(s)${why}`;
}

/**
 * The sweep as text: each row's line, each finished resume tab, the residue reap, the tree reclaim, then the
 * summary.
 *
 * @param dryRun whether the sweep only reported, which every line's verb follows
 * @param swept what the sweep did
 */
export function printCloseDoneText({ dryRun, swept }: { dryRun: boolean; swept: CloseDoneSwept }): void {
  swept.outcomes.forEach((outcome) => {
    const line = renderCloseDoneOutcome({ dryRun, outcome });
    if (line !== undefined) {
      logger.out({ line });
    }
  });
  swept.goneSeats.forEach((gone) => {
    logger.out({ line: renderGoneSeat({ dryRun, gone }) });
  });
  swept.shells.forEach((outcome) => {
    logger.out({ line: renderShellOutcome({ dryRun, outcome }) });
  });
  renderResidueReport({ dryRun, report: swept.residue, verb: "session close-done" }).forEach((line) => {
    logger.out({ line });
  });
  printReclaim({ dryRun, report: swept.reclaimed });
  if (swept.trash !== null) {
    const trashLine = renderTrash({ trash: swept.trash });
    if (trashLine !== undefined) {
      logger.out({ line: trashLine });
    }
  }
  logger.out({ line: closeDoneSummary({ dryRun, swept }) });
}
