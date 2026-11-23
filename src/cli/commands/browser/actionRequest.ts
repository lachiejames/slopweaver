/**
 * What `browser act` asks the executor to do, built from the validated invocation. Pure: the effectful shell that
 * resolves the session, the client and the door is `./actionRun.ts`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { BrowserActionRequest } from "../../../browser/actionExecutor.js";
import type { AimMark } from "../../../browser/aimShot.js";
import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";
import type { BrowserActOptions } from "./actionCore.js";

/**
 * What the executor is asked to do, built from the validated invocation.
 *
 * Pure, and separate from the thunk that runs it so the three choices it makes are readable on their own:
 * where a download is watched, which read the action is judged against, and where the after-picture goes.
 *
 * @param options the validated invocation
 * @param session the live session, whose workspace holds the after-picture when `--out` names no path
 * @param observation the session's latest look
 * @param nowIso the instant this action is judged at, which names the picture
 * @param aimMark how the aim shot marks its target, already gated against the page's own posture
 * @returns the request
 */
export function actionRequest({
  options,
  session,
  observation,
  nowIso,
  aimMark,
}: {
  options: BrowserActOptions;
  session: InteractionSession;
  observation: PageObservation | null;
  nowIso: string;
  aimMark: AimMark;
}): BrowserActionRequest {
  // Where a download is watched. The owner's own Downloads directory is the browser's default and the one a caller
  // who named none meant. A destructured default rather than an operator, per `no-silent-fallback`: the
  // substitution is a line of code a reader can see, and it is the one spelling `prefer-nullish-coalescing`
  // does not push back to `??=`.
  const { downloadDir = join(homedir(), "Downloads") } = options;
  // The executor is handed the observation only when the caller CITED one — an uncited action is refused
  // upstream if it could change the page, and a read-only one is judged against the live page instead.
  let cited: PageObservation | undefined;
  if (options.observationId !== undefined && observation !== null) {
    cited = observation;
  }
  // `--out` means the DOWNLOADED FILE on a download and the after-picture on everything else. One flag
  // rather than two, because on a download the file IS the result a caller came for and the picture is the
  // evidence beside it — which then lands in the session's own directory and is named in the receipt, so
  // nothing is lost by not asking for its path.
  const stamp = nowIso.replaceAll(":", "-");
  let screenshotPath = join(session.workspace, `act-${stamp}.png`);
  if (options.kind !== "download" && options.out !== undefined) {
    screenshotPath = options.out;
  }
  return {
    aimMark,
    // The before-pictures always land in the session's own directory and are never `--out`. `--out` is the
    // thing the caller came for — the downloaded file, or the after-picture — and pointing both halves of the
    // evidence at one path would have the aim shot overwritten by the result of the action it was taken to
    // show, which is the one pair that has to be comparable.
    aimShotStem: join(session.workspace, `aim-${stamp}`),
    downloadDir,
    downloadOut: options.kind === "download" ? options.out : undefined,
    expectFocus: options.expectFocus,
    expectName: options.expectName,
    fullPage: options.fullPage,
    kind: options.kind,
    observation: cited,
    screenshotPath,
    target: options.target,
    value: options.value,
  };
}

/**
 * What the door ledger records about one `browser act`: the kind, the page it was taken on and the element it was
 * aimed at.
 *
 * @param options the validated invocation
 * @param observation the session's latest look; null when it has read no page yet
 * @returns the artifact, `null` in a field the action does not have — a reload or a dialog dismissal names no
 *   element — written out rather than defaulted so the absent case is a line of code
 */
export function actLedgerArtifact({
  options,
  observation,
}: {
  options: BrowserActOptions;
  observation: PageObservation | null;
}): { readonly do: BrowserActOptions["kind"]; readonly page: string | null; readonly target: string | null } {
  let target: string | null = null;
  if (options.target !== undefined) {
    target = options.target;
  }
  return { do: options.kind, page: observation === null ? null : observation.url, target };
}
