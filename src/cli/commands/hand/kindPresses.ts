/**
 * The one place a verb records the owner's kind-answer presses (`../../../monitor/kindAnswerPresses.ts`) and says what each
 * came to — `monitor check --fire`, `hand push`, `hand wake`, `hand show` and `hand mute` all run it after their
 * reconcile, so a press is honoured before any of them asks whether to raise a note, and each exits 1 once it has met a
 * problem here: a press it could not honour may still keep a note down.
 */
import type { HandStep } from "../../../hand/step.js";
import { readEscalationHolds } from "../../../monitor/escalationHolds.js";
import { type KindPressOutcome, recordKindAnswerPresses } from "../../../monitor/kindAnswerPresses.js";
import { readNoteMutes } from "../../../monitor/noteMutes.js";

/**
 * One press's line.
 *
 * @param outcome what the press came to
 * @returns the line, or undefined for a refusal, which its problem line already names
 */
function pressLine({ outcome }: { outcome: KindPressOutcome }): string | undefined {
  switch (outcome.kind) {
    case "muted":
      return `muted ${outcome.monitorId}'s note (pressed on ${outcome.stepId}) — its cards still post; \`slopweaver hand mute remove ${outcome.monitorId}\` reverses it`;
    case "held":
      return `${outcome.stepId}'s note stays down until ${outcome.base} reads worse`;
    case "moot":
      return `"When it gets worse" on ${outcome.stepId} came to nothing: ${outcome.why}`;
    case "refused":
      return undefined;
  }
}

/**
 * Record every waiting kind-answer press and write one line per press and per problem.
 *
 * @param home the state home
 * @param open every step the register carries open, read after the reconcile
 * @param verb the verb's name, which opens each line
 * @param writeDiagnostic where the lines go — stderr, beside the reconcile's own report
 * @returns how many problems were met, so a caller can choose its exit
 */
export function recordAndReportKindPresses({
  home,
  open,
  verb,
  writeDiagnostic,
}: {
  home: string;
  open: readonly HandStep[];
  verb: string;
  writeDiagnostic: (line: string) => void;
}): number {
  const report = recordKindAnswerPresses({ home, open });
  for (const outcome of report.outcomes) {
    const line = pressLine({ outcome });
    if (line !== undefined) {
      writeDiagnostic(`${verb}: ${line}`);
    }
  }
  for (const problem of report.problems) {
    writeDiagnostic(`${verb}: ${problem.message}`);
  }
  return report.problems.length;
}

/**
 * Record the owner's presses as {@link recordAndReportKindPresses} does, then read both kind-answer stores and name every
 * failure met there. A store that will not list, or a record that will not read, may hold a note down that this verb
 * would otherwise go on as if absent — so each one counts against the verb's exit. `hand mute` lists the stores
 * itself and calls {@link recordAndReportKindPresses} alone.
 *
 * @param home the state home
 * @param open every step the register carries open, read after the reconcile
 * @param verb the verb's name, which opens each line
 * @param writeDiagnostic where the lines go
 * @returns how many problems were met, presses and stores together
 */
export function recordKindPressesAndCheckStores({
  home,
  open,
  verb,
  writeDiagnostic,
}: {
  home: string;
  open: readonly HandStep[];
  verb: string;
  writeDiagnostic: (line: string) => void;
}): number {
  const pressProblems = recordAndReportKindPresses({ home, open, verb, writeDiagnostic });
  const storeProblems = [...readNoteMutes({ home }).problems, ...readEscalationHolds({ home }).problems];
  for (const problem of storeProblems) {
    writeDiagnostic(`${verb}: ${problem.message}`);
  }
  return pressProblems + storeProblems.length;
}
