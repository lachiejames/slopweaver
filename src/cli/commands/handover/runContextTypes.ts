/**
 * `RunContext` and the probe printer — the two things every lifecycle GATE needs and neither of which needs
 * the lifecycle itself — plus the parked-checkpoint printer `resume` shows above those probes.
 *
 * Its own module for one mechanical reason: `./startGates.ts` judges a resolved context and `./lifecycle.ts`
 * calls those gates, so leaving either in `./lifecycle.ts` would be an import cycle: `no-cycle` refuses the
 * probe printer's value edge, though not a type-only one. `./lifecycle.ts` re-exports
 * `RunContext` so the two dozen existing importers are untouched.
 *
 * The GLYPH itself is not here: `probeMark` lives in `../../../handover/probe.js`, beside the outcome it
 * describes, because the board prints it too and a CLI module is not somewhere a pure board composer may
 * import from, so every importer reads it from there.
 */

import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent, RunState, UnknownKindLine } from "../../../handover/ledger.js";
import { parkedResumeLines } from "../../../handover/parked.js";
import { type ComputedState, type ProbeResult, probeMark } from "../../../handover/probe.js";
import { type Logger, logger } from "../../../lib/logger.js";

/** Everything a lifecycle verb needs about one doc, resolved once. */
export interface RunContext {
  readonly doc: HandoverDoc;
  readonly text: string;
  readonly results: readonly ProbeResult[];
  readonly computed: ComputedState | undefined;
  readonly commitsAhead: number;
  readonly run: RunState;
  readonly journal: string;
  /** The decoded journal, exposed so command shells can enforce writer ownership before any append. */
  readonly events: readonly RunEvent[];
  /** Lines no command may silently act past. */
  readonly unreadable: readonly number[];
  /**
   * The subset of {@link unreadable} that is a well-formed event this checkout's decoder has no case for.
   *
   * Carried so a verb can ask {@link ../../../handover/ledger.ownershipAmbiguousLines} whether the run's
   * WRITER is really in doubt, and so a refusal can name the word it could not decode. Both fields are here
   * because `RunContext` is structurally a `ParsedLedger` for those two readers — one read of the journal,
   * never a second one that could see a different file.
   */
  readonly unknownKind: readonly UnknownKindLine[];
}

/**
 * The checkout `resume` names on its `repo:` line. A doc may declare none — a row nobody has pointed at a
 * checkout yet — and the line says so rather than printing a blank.
 *
 * @param doc the resolved doc
 * @returns the declared `repo:`, or `(none declared)`
 */
export function declaredRepo({ doc }: { doc: HandoverDoc }): string {
  const { repo } = doc;
  if (repo === undefined) {
    return "(none declared)";
  }
  return repo;
}

/**
 * The question a run waiting on the owner is stopped on. The phase was recorded by an `asked` event whose
 * words this checkout could not read back, and the line says that rather than printing a blank.
 *
 * @param run the run's derived state
 * @returns the recorded question, or `(recorded, but unreadable)`
 */
export function askedQuestion({ run }: { run: RunState }): string {
  const { openQuestion } = run;
  if (openQuestion === undefined) {
    return "(recorded, but unreadable)";
  }
  return openQuestion;
}

/**
 * Print each probe's verdict, so a refusal is never a bare "no".
 *
 * @param results the evaluated probes
 * @param out where each line is written; omitted, stdout through the logger
 */
export function printProbes({
  results,
  out = logger.out,
}: {
  results: readonly ProbeResult[];
  out?: Logger["out"];
}): void {
  results.forEach((result) => {
    out({ line: `  ${probeMark({ outcome: result.outcome })} ${result.note}` });
  });
}

/**
 * Print a parked run's checkpoint, preceded by a blank line, or nothing when the run is not parked: where a
 * closed seat stood, on which tree, and what it waits on — the one thing a reseat needs before the probes. The
 * lines are `../../../handover/parked.ts`'s, which is pure; this only writes them.
 *
 * @param events the run's journal
 * @param slug the row, named in the reseat command the block prints
 * @param out where each line is written; omitted, stdout through the logger
 */
export function printParkedResume({
  events,
  slug,
  out = logger.out,
}: {
  events: readonly RunEvent[];
  slug: string;
  out?: Logger["out"];
}): void {
  const lines = parkedResumeLines({ events, slug });
  if (lines.length === 0) {
    return;
  }
  out({ line: "" });
  lines.forEach((line) => {
    out({ line: `  ${line}` });
  });
}
