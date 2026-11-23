/**
 * The last stretch of `handover finish`, held under the row's closing lock (`./closingLock.ts`): the uncarded-page
 * gate, the probe gates and the `finished` write. Under the lock from the page gate's journal read to the write, so a
 * `page publish` cannot make a page the artifact between the two.
 */
import { type BehaviouralProbeMode } from "../../../handover/behaviouralProbe.js";
import type { BoundPark } from "../../../handover/parkedFinish.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { acquireClosingLock } from "./closingLock.js";
import { journalFinished, reportFinishDryRun } from "./finishEnding.js";
import { behaviouralProbeRefuses, residueOf, residueRefuses } from "./finishRefusals.js";
import { recordForcedLessons } from "./lessonsGate.js";
import { type RunContext } from "./runContextTypes.js";
import { type PageReachReaders, uncardedPageGateRefuses } from "./uncardedPageGate.js";

/** What the closing stretch reads — the resolved run and the flags `finishRun` already validated. */
interface FinishCloseInput {
  readonly context: RunContext;
  readonly dryRun: boolean;
  readonly forced: boolean;
  /** The lessons gate passed on its break-glass and left the forced line for this stretch to journal. */
  readonly forcedLessons: boolean;
  readonly home: string;
  readonly mode: BehaviouralProbeMode;
  readonly nowIso: string;
  /** The one park the `finished` append may close, or `undefined` for any park standing. */
  readonly park: BoundPark | undefined;
  readonly readPageReach: PageReachReaders | undefined;
  readonly runsDir: string;
  readonly structuralAllowed: boolean;
}

/**
 * Take the row's closing lock and run the close's critical section under it.
 *
 * @param input the resolved run and its validated flags
 * @returns the process exit code — an error when another settle, finish or page publish holds the lock
 */
export function finishUnderClosingLock(input: FinishCloseInput): number {
  const slug = input.context.doc.slug;
  const lock = acquireClosingLock({ home: input.home, nowIso: input.nowIso, slug });
  if (lock.isErr()) {
    logger.error({ msg: `handover finish: a settle, finish or page publish of ${slug} is running — ${lock.error}` });
    return EXIT_ERROR;
  }
  try {
    return closeRun(input);
  } finally {
    lock.value.release();
  }
}

/**
 * The page gate, the probe gates and the `finished` write.
 *
 * @param input the resolved run and its validated flags
 * @returns the process exit code
 */
function closeRun({
  context,
  dryRun,
  forced,
  forcedLessons,
  home,
  mode,
  nowIso,
  park,
  readPageReach,
  runsDir,
  structuralAllowed,
}: FinishCloseInput): number {
  // A run whose effective artifact is a page closes only once that page reached the owner's Queue — nine briefings the owner
  // asked for have finished without one (`./uncardedPageGate.ts`). Before the probes and the dry run, so both refuse.
  const uncarded = uncardedPageGateRefuses({
    candidate: { kind: "artifact" },
    doc: context.doc,
    home,
    readers: readPageReach,
    runsDir,
    verb: "finish",
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
  });
  if (uncarded) {
    return EXIT_ERROR;
  }
  if (behaviouralProbeRefuses({ doc: context.doc, mode, structuralAllowed })) {
    return EXIT_ERROR;
  }
  const residue = residueOf({ results: context.results });
  if (residueRefuses({ context, forced, nowIso, residue, runsDir })) {
    return EXIT_ERROR;
  }
  if (dryRun) {
    return reportFinishDryRun({ nowIso, residue, slug: context.doc.slug });
  }
  const finished = journalFinished({ context, nowIso, park, residue, runsDir });
  // AFTER the `finished` append, never before: that append carries its own ownership precondition, and a dispatch
  // clearing the park between two appends would refuse it with the forced line already written. A forced
  // answer therefore only ever sits on a run that closed (`./lessonsGate.ts` § lessonsGateVerdict); `lessons` is
  // inert in the phase fold, so its place after `finished` changes no state. Residue, stated: a process killed
  // between the two leaves a closed run with no forced marker — the loud record lost, never a question spent.
  if (forcedLessons && finished === EXIT_OK) {
    recordForcedLessons({ nowIso, runsDir, slug: context.doc.slug });
  }
  return finished;
}
