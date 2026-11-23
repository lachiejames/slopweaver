/**
 * What `browser act` refuses before any browser round trip: an after-picture `--out` inside a checkout, and an
 * action that cites no read, or a read the page has moved past.
 */
import { actionNeedsObservation } from "../../../browser/actionRequest.js";
import type { PageObservation } from "../../../browser/interactionSession.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import type { BrowserActOptions } from "./actionCore.js";

/**
 * Why an after-picture's `--out` may not be written, asked before the session is touched.
 *
 * A DOWNLOAD's `--out` is the downloaded file, which is not proof, so only the after-picture is judged.
 *
 * @param options the validated invocation
 * @param home the state home, which is allowed
 * @param cwd the directory a relative `--out` resolves against
 * @param env the environment, read only for the hatch
 * @returns the refusal lines, empty when the picture may be written
 */
export function actOutputRefusal({
  options,
  home,
  cwd,
  env,
}: {
  options: BrowserActOptions;
  home: string;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  if (options.kind === "download" || options.out === undefined) {
    return [];
  }
  const placement = refuseProofOutputInTree({ cwd, env, home, output: options.out });
  return placement.isErr() ? placement.error : [];
}

/**
 * Every problem with the read this action was decided against — empty when there is none.
 *
 * Pure, and its own function so `runBrowserAct` reads as a sequence of admissions rather than one long body.
 * An interaction that can change the page must cite a read, and the read it cites must still be the
 * session's latest: a citation of a read the page has moved past is exactly the case the executor's own
 * stale-observation arm exists for, refused here first so it costs no browser round trip.
 *
 * @param options the validated invocation
 * @param observation the session's latest look, or `null` when it has never read one
 * @returns the problems, in the order a caller should read them
 */
export function citationProblems({
  options,
  observation,
}: {
  options: BrowserActOptions;
  observation: PageObservation | null;
}): readonly string[] {
  if (actionNeedsObservation({ kind: options.kind }) && options.observationId === undefined) {
    return [
      `\`--do ${options.kind}\` can change the page, so it must cite the read it was decided against`,
      `take one with \`slopweaver browser read --session ${options.sessionId}\` and pass --observation <id>`,
    ];
  }
  if (options.observationId !== undefined && observation?.id !== options.observationId) {
    const latest = observation === null ? "none" : observation.id;
    return [
      `this session's latest read is ${latest}, not ${options.observationId}`,
      "read the page again and decide against what is there now",
    ];
  }
  return [];
}
