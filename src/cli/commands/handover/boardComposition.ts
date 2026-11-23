/**
 * The board's one composition — scan the docs, sweep the journals no doc claims, read every journal, resolve the
 * probes and compose each row — shared by `handover list` (`./run.ts`) and `handover alignment-board`
 * (`./alignmentBoardRun.ts`).
 *
 * One implementation on purpose: a second, reduced composer for the Alignment projection would be free to disagree
 * with the board about a row's section, run, tags or action, and every one of those places an act.
 */

import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { type TagFilter } from "../../../handover/tagFilter.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { incompleteTagWarningLines } from "./listPresentation.js";
import { isSettledWait, type ListRecovery, recoveredRows, recoverListJournals } from "./listRecovery.js";
import { type Deadline, probeStates } from "./probeSweep.js";

/**
 * How long the probe sweep may run before the board prints what it has.
 *
 * MEASURED on the owner's own board, and the reason a budget exists at all: 1,387 docs took 474
 * seconds end to end with ZERO bytes on stdout and stderr until the last moment, so every caller with a sane
 * timeout read an empty board — which `AGENTS.md` makes indistinguishable from nothing being in flight. The
 * per-repository ahead index in `handover/evaluate.ts` took the sweep itself from 501.1 s to a handful of git
 * calls; this is the backstop for a board that outgrows even that. Reproduce with
 * `time slopweaver handover list | wc -l`.
 *
 * 60 rather than something tighter: the whole verb measured ~12.4 s outside the sweep on that same board
 * (scan 5.9 s, journals 3.1 s, stale repos 2.1 s), so a budget in the same order as the rest of the work
 * would truncate a board that is merely large rather than one that is pathological.
 */
export const DEFAULT_DEADLINE_SECONDS = 60;

/** The docs a scan found, the files that would not read, and what the journal sweep recovered. */
export interface ScannedBoard {
  readonly docs: readonly HandoverDoc[];
  readonly recovery: ListRecovery;
  readonly unreadable: readonly string[];
}

/**
 * Scan the board, then sweep the journals no board doc claims — logging a scan that fails.
 *
 * @param verb the command's name, prefixing every progress line it writes to stderr
 * @returns the board's docs, the files that would not read and what the sweep recovered, or the scan's failure
 *   once it is logged
 */
export function scannedBoard({
  handoverDir,
  home,
  verb,
}: {
  handoverDir: string;
  home: string;
  verb: string;
}): { readonly kind: "scanned"; readonly board: ScannedBoard } | { readonly kind: "failed"; readonly why: string } {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `${verb}: ${scan.error.message}` });
    return { kind: "failed", why: scan.error.message };
  }
  logger.info({ msg: `${verb}: ${String(scan.value.docs.length)} doc(s) scanned; resolving probes…` });
  const recovery = recoverListJournals({
    claimed: new Set(scan.value.docs.map((doc) => doc.slug)),
    handoverDir,
    liveUnreadable: scan.value.unreadable,
    runsDir: stateHomePaths({ home }).runs,
  });
  return { board: { docs: scan.value.docs, recovery, unreadable: scan.value.unreadable }, kind: "scanned" };
}

/**
 * A stderr progress line, at most one per second.
 *
 * Rate-limited by TIME rather than by doc count, because the two ends of the sweep are orders of magnitude
 * apart in cost — a repository whose ahead index is already built resolves a doc in microseconds, while the
 * one that builds it pays a `for-each-ref`. A count-based tick is either a flood or a silence depending on
 * which end you land in.
 *
 * @returns the callback `probeStates` reports each resolved doc to
 */
function progressSink({ verb }: { verb: string }): (progress: { resolved: number; total: number }) => void {
  let lastAt = 0;
  return ({ resolved, total }) => {
    const now = Date.now();
    if (now - lastAt < PROGRESS_INTERVAL_MS && resolved !== total) {
      return;
    }
    lastAt = now;
    logger.info({ msg: `${verb}: resolved ${String(resolved)}/${String(total)} doc(s) with probes` });
  };
}

/** How often the sweep says it is still alive. Diagnostic, so frequent enough to watch and cheap enough to ignore. */
const PROGRESS_INTERVAL_MS = 1000;

/**
 * Every row composed from its journal and probe evidence, warning on stderr of each row whose journal the filter
 * would read and could not read whole.
 *
 * The board's own rows compose exactly as they would with nothing recovered; the recovered roots — a waiting run's
 * doc found in the archive — compose in their own pass (`recoveredRows`), are kept only while `ownerWait` says
 * the question is still open (the settled rest is returned apart, for `../../../handover/settledAsk.ts` alone), and
 * are never PROBED: a probe answers whether live work shipped, and running an
 * archived doc's `command:` probes under `--probe` would widen what that flag runs.
 *
 * @param verb the command's name, prefixing every progress line it writes to stderr
 * @returns every composed row, the recovered rows left out as settled, and the probe sweep that placed them
 */
export function composedBoard({
  docs,
  filter,
  handoverDir,
  home,
  base,
  recovery,
  runCommands,
  deadline,
  verb,
}: {
  docs: readonly HandoverDoc[];
  filter: TagFilter;
  handoverDir: string;
  home: string;
  base: string | undefined;
  recovery: ListRecovery;
  runCommands: boolean;
  deadline: Deadline;
  verb: string;
}): {
  models: readonly BoardModel[];
  settledOffBoard: readonly BoardModel[];
  sweep: ReturnType<typeof probeStates>;
} {
  const journals = new Map([
    ...journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs }),
    ...recovery.journals,
  ]);
  logger.info({ msg: `${verb}: ${String(journals.size)} journal(s) read` });
  const sweep = probeStates({ base, deadline, docs, onProgress: progressSink({ verb }), runCommands });
  const recovered = recoveredRows({ docs, handoverDir, journals, probeStates: sweep.states, recovery });
  const models = [
    ...composeBoardModels({
      journals,
      probeStates: sweep.states,
      resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
      roots: docs,
    }),
    ...recovered.filter((model) => !isSettledWait({ model })),
  ];
  incompleteTagWarningLines({ filter, models }).forEach((msg) => {
    logger.warn({ msg });
  });
  return { models, settledOffBoard: recovered.filter((model) => isSettledWait({ model })), sweep };
}
