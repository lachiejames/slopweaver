/**
 * Where a `desktop e2e` run writes and prints, apart from the verb that drives it (`./e2eRun.ts`): the proof folder,
 * the report and the two fidelity files beside it, and the lines a run not answering in JSON prints as it goes.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { cardFidelityHtml, cardFidelityTable } from "../../../desktop/cardFidelityReport.js";
import type { E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import { e2eRunId } from "../../../desktop/e2ePlan.js";
import type { E2eReport, E2eStepResult } from "../../../desktop/e2eReport.js";
import { e2eStepLine } from "../../../desktop/e2eReport.js";
import type { E2eTranscriptFidelityTrial } from "../../../desktop/e2eTranscriptFidelityReport.js";
import { transcriptFidelityReport } from "../../../desktop/e2eTranscriptFidelityVerdict.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * Where a run's photographs and report go: `--out`, or a folder named for its start under the state home's proof.
 *
 * @param out the `--out` folder, `undefined` when not named
 * @param home the state home
 * @param startedIso when the run started
 * @returns the folder
 */
export function proofDirOf({
  out,
  home,
  startedIso,
}: {
  out: string | undefined;
  home: string;
  startedIso: string;
}): string {
  if (out !== undefined) {
    return out;
  }
  return join(stateHomePaths({ home }).desktopE2eProofDir, e2eRunId({ startedIso }));
}

/**
 * The report, the card sweep's failure table and the paired microphone comparison, each written beside the
 * photographs when the run produced one.
 *
 * @param out the run's proof folder
 * @param report the run's report
 * @param steps every step result the run produced, walk and calls
 * @param calls the call steps the run asked for
 * @param trials every `transcription-fidelity` call's trial
 */
export function writeRunFiles({
  out,
  report,
  steps,
  calls,
  trials,
}: {
  out: string;
  report: E2eReport;
  steps: readonly E2eStepResult[];
  calls: readonly E2eCallStep[];
  trials: readonly E2eTranscriptFidelityTrial[];
}): void {
  writeFileAtomic({ contents: `${JSON.stringify(report, null, 2)}\n`, path: join(out, "report.json") });
  writeCardFidelity({ out, steps });
  writeTranscriptFidelity({ calls, out, trials });
}

/**
 * Write the paired microphone comparison beside the report, when the run asked for one — even a run that stopped
 * early, whose report then says which pairs are missing rather than leaving no file.
 *
 * @param calls the call steps the run asked for
 * @param out the run's proof folder
 * @param trials every `transcription-fidelity` call's trial
 */
function writeTranscriptFidelity({
  calls,
  out,
  trials,
}: {
  calls: readonly E2eCallStep[];
  out: string;
  trials: readonly E2eTranscriptFidelityTrial[];
}): void {
  const asked = calls.find((step) => step.fidelity !== undefined);
  const fidelity = asked?.fidelity;
  if (fidelity === undefined) {
    return;
  }
  const report = transcriptFidelityReport({ candidate: fidelity.candidate, trials });
  writeFileAtomic({ contents: `${JSON.stringify(report, null, 2)}\n`, path: join(out, "transcript-fidelity.json") });
}

/**
 * Write the card sweep's failure table beside the report, the page's source (`src/desktop/cardFidelityReport.ts`),
 * when the run judged any card.
 *
 * @param out the run's proof folder
 * @param steps every step result the run produced, walk and calls
 */
function writeCardFidelity({ out, steps }: { out: string; steps: readonly E2eStepResult[] }): void {
  const fidelity = cardFidelityTable({ results: steps });
  if (fidelity.rows.length === 0) {
    return;
  }
  writeFileAtomic({ contents: `${JSON.stringify(fidelity, null, 2)}\n`, path: join(out, "card-fidelity.json") });
  writeFileAtomic({ contents: `${cardFidelityHtml({ table: fidelity })}\n`, path: join(out, "card-fidelity.html") });
}

/**
 * The call leg's side notes, printed only when the run is not answering in JSON.
 *
 * @param json whether the run prints its report as JSON alone
 * @returns the note sink
 */
export function quietNote({ json }: { json: boolean }): ({ line }: { line: string }) => void {
  return ({ line }) => {
    if (!json) {
      logger.out({ line });
    }
  };
}

/**
 * Each step's line as it finishes, printed only when the run is not answering in JSON.
 *
 * @param json whether the run prints its report as JSON alone
 * @returns the progress sink
 */
export function stepProgress({ json }: { json: boolean }): ({ result }: { result: E2eStepResult }) => void {
  const note = quietNote({ json });
  return ({ result }) => {
    note({ line: e2eStepLine({ result }) });
  };
}
