/**
 * The dry-run stop of `github pr update`: print what the update would do, send nothing, and answer the exit code.
 * Split from `./updateFlow.ts`, which decides whether the run is a dry run at all.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import type { PrForm } from "../../../outbound/github/types.js";
import { type AboveFoldVerdict, aboveFoldLines } from "../../aboveFoldDoor.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { dryRunLines } from "./core.js";
import type { GithubPrDeps } from "./prDeps.js";
import type { RenderedBody } from "./prRenderGate.js";

/**
 * Print what an update would do. A refused above-the-fold verdict fails even a dry run.
 *
 * @param aboveFold the above-the-fold verdict already read for the form
 * @param body the body the update would send
 * @param deps the verb's output edge
 * @param form the form as previewed
 * @param live the pull request as read
 * @param locus the address the update names
 * @param rendered the rendered-body validation the preview prints
 * @returns the process exit code
 */
export function printUpdateDryRun({
  aboveFold,
  body,
  deps,
  form,
  live,
  locus,
  rendered,
}: {
  aboveFold: AboveFoldVerdict;
  body: string;
  deps: GithubPrDeps;
  form: PrForm;
  live: WrittenPr;
  locus: string;
  rendered: RenderedBody;
}): number {
  const lines = [
    ...dryRunLines({ body, form, validation: rendered }),
    ...aboveFoldLines({ verdict: aboveFold }),
    `would update #${String(live.number)} (${locus})`,
    "dry run: a token was resolved and the pull request was READ; no door record, no PATCH.",
  ];
  for (const line of lines) {
    deps.out({ line });
  }
  return aboveFold.refusals.length === 0 ? EXIT_OK : EXIT_ERROR;
}
