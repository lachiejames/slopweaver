/**
 * The two refusals `hand post` makes about WHAT a note shows rather than how it is worded: a check-in naming a row
 * whose pull request is unmerged, and a `--url` whose page the post opened and found showing nothing. Both are the
 * incident of the chair floating a note onto a page that did not show the thing yet — and both
 * run after every pure posting rule, so a step already refused on its words never touches GitHub or the owner's browser.
 *
 * Each is a policy refusal with a hatch (`../../../hatch/registry.ts`, `unmerged-check-in` and `unseen-hand-url`).
 */
import { unmergedRowProblem } from "../../../hand/rowPullRequest.js";
import type { HandShot } from "../../../hand/shot.js";
import type { ReadShot } from "../../../hand/shotStore.js";
import type { HandStep } from "../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { EXIT_ERROR } from "../../exitCodes.js";

import type { HandDeps } from "./deps.js";

/**
 * The variable letting a check-in name a row whose pull request is unmerged. A LITERAL, so `escape-hatch` in `yarn
 * lint` sees this module name its own key.
 */
const UNMERGED_CHECK_IN_HATCH = "SLOPWEAVER_ALLOW_UNMERGED_CHECK_IN";

/** The variable letting a step post a `--url` whose page the post could not see show anything. A LITERAL, as above. */
const UNSEEN_HAND_URL_HATCH = "SLOPWEAVER_ALLOW_UNSEEN_HAND_URL";

/** A web address — the only kind the post opens. A `file://` one is refused earlier, by `../../../hand/localFileUrl.ts`. */
const WEB_URL = /^https?:\/\//iu;

/**
 * Refuse a check-in whose named row has not shipped, or say nothing when it may be posted.
 *
 * @param step the built, admitted step
 * @param deps the seams — the row's pull requests, read before the verb ran, and the diagnostic channel
 * @param env the environment the hatch is read from
 * @returns the exit code a refusal ends the verb with, or `undefined` when the step may be posted
 */
export function unmergedCheckInExit({
  step,
  deps,
  env,
}: {
  step: HandStep;
  deps: HandDeps;
  env: Readonly<Record<string, string | undefined>>;
}): number | undefined {
  if (step.checkIn !== true || step.row === undefined) {
    return undefined;
  }
  const problem = unmergedRowProblem({ answer: deps.rowPullRequests({ row: step.row }), row: step.row });
  if (problem === undefined) {
    return undefined;
  }
  const opened = env[UNMERGED_CHECK_IN_HATCH] === "1";
  if (opened) {
    deps.writeDiagnostic(`hand post: admitted past ${UNMERGED_CHECK_IN_HATCH}=1 — --row ${problem}`);
    return undefined;
  }
  deps.writeDiagnostic(hatchRefusal({ detail: `--row ${problem}`, hatch: hatchFor({ id: "unmerged-check-in" }) }));
  deps.writeDiagnostic("NOTHING was recorded: land the row's pull request, pull the base, then post the check-in.");
  return EXIT_ERROR;
}

/**
 * Open the step's web `--url` and refuse it when the page shows nothing, or hand back the picture it took.
 *
 * @param step the built, admitted step
 * @param home the state home the browser session record lives under
 * @param deps the seams — the look and the diagnostic channel
 * @param env the environment the hatch is read from
 * @returns the exit code a refusal ends the verb with, or the look's picture — `undefined` when there is none, the
 *   step has no web `--url`, or the hatch let an unseen page through
 */
export async function lookedAtUrl({
  step,
  home,
  deps,
  env,
}: {
  step: HandStep;
  home: string;
  deps: HandDeps;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly exit: number } | { readonly picture: ReadShot | undefined }> {
  const url = step.url;
  if (url === undefined || !WEB_URL.test(url)) {
    return { picture: undefined };
  }
  const look = await deps.lookAt({ home, url });
  if (look.kind === "seen") {
    return { picture: look.picture };
  }
  const detail =
    look.kind === "not-shown" ? `the page ${look.why}` : `the browser could not look at ${url} — ${look.why}`;
  const opened = env[UNSEEN_HAND_URL_HATCH] === "1";
  if (opened) {
    deps.writeDiagnostic(`hand post: admitted past ${UNSEEN_HAND_URL_HATCH}=1 — ${detail}`);
    return { picture: undefined };
  }
  deps.writeDiagnostic(hatchRefusal({ detail, hatch: hatchFor({ id: "unseen-hand-url" }) }));
  deps.writeDiagnostic(
    "NOTHING was recorded: a note opens what it links, so the link has to show the thing before the owner is asked to look.",
  );
  return { exit: EXIT_ERROR };
}

/**
 * The picture a step carries from the post's look: the one an earlier posting of the same id already recorded, else
 * the one this look took. An exact retry must read as the SAME posting, and a second screenshot of a live page is
 * never byte-identical to the first — so a retry carrying a fresh one would be refused as a conflict on `shot`.
 *
 * @param home the state home the register lives under
 * @param id the step's id
 * @param taken the picture this post's look took, when it took one
 * @returns the step's `shot` and the bytes still to store (`undefined` when they are stored already), or
 *   `undefined` when there is no picture
 */
export function lookPicture({
  home,
  id,
  taken,
}: {
  home: string;
  id: string;
  taken: ReadShot | undefined;
}): { readonly shot: HandShot; readonly read: ReadShot | undefined } | undefined {
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  const earlier = register.isOk()
    ? register.value.rows.findLast((row) => row.kind === "posted" && row.step.id === id)
    : undefined;
  const recorded = earlier?.kind === "posted" ? earlier.step.shot : undefined;
  if (recorded?.boxes.length === 0) {
    return { read: undefined, shot: recorded };
  }
  if (taken === undefined) {
    return undefined;
  }
  const { height, sha256, width } = taken;
  return { read: taken, shot: { boxes: [], height, sha256, width } };
}
