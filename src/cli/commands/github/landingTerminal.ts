/**
 * What one `github landing` read prints: the `--json` document, or the fact lines (the default) or the table
 * (`--full`), then the tally, the dispatch line and every act the run performed.
 *
 * Split from `./landingRun.ts` along the seam between deciding and printing. `--pr` prints through
 * `./landingDetail.ts` instead, and never reaches this.
 */

import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { ReadCadence } from "../../../review/readJournal.js";
import { walkthroughWarningLine } from "../../../review/walkthroughClearance.js";
import { collapsedResidueLine, landingCompactLines } from "./landingCompactReport.js";
import type { GithubLandingArgs } from "./landingCore.js";
import type { GithubLandingDeps } from "./landingDepsContract.js";
import { type LandingDocument, landingDispatchLine, landingTable, landingTallyLine } from "./landingReport.js";

/**
 * Print the facts, the table or the document, plus whatever the presses and the registrations did.
 *
 * Takes the ALREADY-BUILT document rather than assembling a second one, so the terminal lines and the
 * document can never disagree about how many rows are left to send — its own `dispatchable` is the one place
 * that decides it, and it is also what `--register` was handed.
 *
 * @param document the document this read built
 * @param cadence why this read was due, named under `--if-due`
 * @param args the parsed invocation, for `--json`, `--full`, `--if-due` and whose rows these are
 */
export function reportLanding({
  document,
  cadence,
  args,
  deps,
}: {
  document: LandingDocument;
  cadence: ReadCadence;
  args: GithubLandingArgs;
  deps: Pick<GithubLandingDeps, "writeOut" | "writeDiagnostic">;
}): void {
  if (args.json) {
    deps.writeOut(safeJsonStringify({ label: "github landing document", value: document }));
    return;
  }
  const lines = args.full ? landingTable({ rows: document.rows }) : landingCompactLines({ rows: document.rows });
  for (const line of lines) {
    deps.writeOut(line);
  }
  deps.writeOut(landingTallyLine({ tally: document.tally }));
  deps.writeOut(landingDispatchLine({ spawnable: document.dispatchable.length, tally: document.tally }));
  const walkthroughs = args.authoredByOwner ? walkthroughWarningLine({ rows: document.rows }) : undefined;
  if (walkthroughs !== undefined) {
    deps.writeOut(walkthroughs);
  }
  for (const act of [...document.presses, ...document.registrations, ...document.settlements]) {
    deps.writeOut(`${act.outcome}: ${act.repoSlug}#${String(act.number)} — ${act.detail}`);
  }
  if (args.ifDue) {
    deps.writeDiagnostic(`landing: read because ${cadence.why}`);
  }
  // The default folds the residue to one line naming how to read it; --full prints every line.
  const folded = args.full ? undefined : collapsedResidueLine({ residue: document.residue });
  for (const line of folded === undefined ? document.residue : [folded]) {
    deps.writeDiagnostic(line);
  }
}
