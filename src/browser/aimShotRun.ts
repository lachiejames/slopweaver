/**
 * The effectful shell of ONE aim shot: frame the target in the owner's viewport, mark it there, photograph
 * it, and put the mark away.
 *
 * `./aimShot.ts` is the whole of what it decides — which interactions get one, which element is shown, how it
 * is marked, in what order and where each picture goes. This file is the only part of that mechanism that
 * touches the browser, and it is a file of its own so that `browser aim`, which is these steps with no action
 * after them, runs this exact code rather than a second copy of it that could drift.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { BrowserActionError } from "./actionErrors.js";
import {
  type AimFocus,
  type AimScroll,
  type AimShotPlan,
  type AimShotResult,
  type AimShotStep,
  aimShotSteps,
  parseAimFocus,
  parseAimScroll,
} from "./aimShot.js";
import { runClientCommand, type TerminalClientDeps, type TerminalReply } from "./terminalClient.js";
import { captureScreenshot } from "./viewportCapture.js";

/**
 * The two browser calls an aim shot makes: a plain client command, and a picture through the capture that
 * recovers a tab Chrome stopped rendering. A seam so a test can run the step order over a fake browser.
 *
 * @internal
 */
export interface AimShotSeams {
  /** Run one client command against the session's page. */
  readonly client: (request: {
    args: readonly string[];
    deps: TerminalClientDeps;
  }) => Result<TerminalReply, BrowserActionError>;
  /** Take one picture through `./viewportCapture.ts`. */
  readonly capture: (request: {
    args: readonly string[];
    deps: TerminalClientDeps;
  }) => Result<TerminalReply, BrowserActionError>;
}

/** The real browser: the terminal client and the recovering capture. */
const REAL_AIM_SHOT_SEAMS: AimShotSeams = {
  capture: ({ args, deps }) => captureScreenshot({ args, deps }),
  client: ({ args, deps }) => runClientCommand({ args, deps }),
};

/**
 * Frame the target in the viewport, mark it there and photograph it, before anything is done to it.
 *
 * Every movement shows its result. `./aimShot.ts` decides which interactions get one, which element is shown, how it is marked
 * and in what order; this runs what it decided and is the only part of that mechanism that touches the
 * browser.
 *
 * **The hide runs on the failure path too, and that is the point of doing it here rather than in the step
 * list.** A screenshot that fails after the highlight went up would otherwise leave an overlay on the owner's real
 * page precisely when nothing else is going to come back and tidy it — the failure path is the one that
 * leaves a mark. So the hide is attempted, its own outcome is discarded, and the screenshot's failure is what
 * is returned.
 *
 * **A failing HIDE is the one step that does not refuse**, and it is asked by name rather than by position:
 * the picture already exists by then, so refusing an errand over an overlay that would not come down would
 * be refusing it for a cosmetic reason. Everything earlier is a failure to establish what is about to be
 * touched, which is the whole reason this step exists.
 *
 * `mayAct` stays at its reading default on every step here, and the claim it makes is narrow: none of them
 * can have INTERACTED with the page, so a caller must not be told a click might have landed. The scroll and
 * the focus DO leave marks — `./aimShot.ts` names both — and neither is something `mayAct` describes, which
 * is about whether the errand may already have happened.
 *
 * It takes the PLAN rather than the request, so `browser aim` — the same steps with no action after them —
 * runs this exact code instead of a second copy of it that could drift.
 *
 * **The focus is checked against the page the browser is ON, one last time, for free.** The caller decides
 * whether a focus may be taken at all — `src/cli/commands/browser/actionCore.ts`'s `resolveAimMark` — but it decides
 * against the read the caller CITED, and the aim shot deliberately runs before the admission (the measured
 * ordering rule in `./actionExecutor.ts`). So a page that moved between that read and this step would
 * otherwise have its focus and blur handlers fired before the staleness refusal caught it. Every client reply
 * names the page it was answered on, and a marked shot evaluates the scroll BEFORE the focus, so `mayFocusOn`
 * gets a page read after the citation at no extra round trip. A reply that names no page leaves the caller
 * decision standing, which is the behaviour without this check rather than a worse one.
 *
 * @param plan the element, the mark and where each picture goes
 * @param deps the client and the session it runs under
 * @param mayFocusOn whether this session may fire a page handler on the page the browser turns out to be on
 * @param seams the browser calls, the real client and capture unless a test passes a fake
 * @returns the pictures and what the page said while they were taken, or the typed failure — in either case
 *   the page has not been acted on
 */
export function photographTheAim({
  plan,
  deps,
  mayFocusOn,
  seams = REAL_AIM_SHOT_SEAMS,
}: {
  plan: AimShotPlan;
  deps: TerminalClientDeps;
  mayFocusOn: (url: string) => boolean;
  seams?: AimShotSeams;
}): Result<AimShotResult, BrowserActionError> {
  const seen: SeenSoFar = { focus: null, liveUrl: null, pictureUrls: [], scroll: null };
  for (const step of aimShotSteps({ plan })) {
    if (step.what === "focus" && seen.liveUrl !== null && !mayFocusOn(seen.liveUrl)) {
      continue;
    }
    const reply = runStep({ deps, seams, step });
    if (reply.isErr()) {
      if (step.what === "hide") {
        return ok({ focus: seen.focus, pictureUrls: seen.pictureUrls, plan, scroll: seen.scroll });
      }
      hideHighlight({ deps, plan, seams });
      return err(reply.error);
    }
    absorb({ reply: reply.value, seen, step });
  }
  return ok({ focus: seen.focus, pictureUrls: seen.pictureUrls, plan, scroll: seen.scroll });
}

/** The steps that photograph, which take the capture's own recovery (`./viewportCapture.ts`). */
const CAPTURE_STEPS: ReadonlySet<AimShotStep["what"]> = new Set(["before", "aimed", "page"]);

/**
 * Run one step: a picture through the capture, which recovers a tab Chrome stopped rendering, and every other
 * step as the plain client command it is.
 *
 * @param step the step to run
 * @param deps the client and the session it runs under
 * @param seams the browser calls the step goes through
 * @returns what the client said, or the typed failure
 */
function runStep({
  step,
  deps,
  seams,
}: {
  step: AimShotStep;
  deps: TerminalClientDeps;
  seams: AimShotSeams;
}): Result<TerminalReply, BrowserActionError> {
  if (CAPTURE_STEPS.has(step.what)) {
    return seams.capture({ args: step.args, deps });
  }
  return seams.client({ args: step.args, deps });
}

/**
 * What the shot has learned from the replies so far.
 *
 * Mutable, and deliberately so: it is the loop's own accumulator, threaded into {@link absorb} rather than
 * rebuilt, so the loop reads as run-a-step, absorb-the-reply rather than as five assignments in a body.
 *
 * `liveUrl` is the load-bearing one. Every client reply carries the page it was answered on when the client
 * named one, and a marked shot's first step is an `eval`, so by the time the focus step comes round this
 * holds a page read strictly AFTER the caller's cited one — which is what closes the window in the header.
 *
 * `pictureUrls` is narrower: one entry per PICTURE step's reply, `null` where it named no page, so a page that
 * moves before the closing hide cannot re-attribute pictures already taken, and no picture is silently skipped.
 */
interface SeenSoFar {
  scroll: AimScroll | null;
  focus: AimFocus | null;
  liveUrl: string | null;
  pictureUrls: (string | null)[];
}

/**
 * Take what one reply had to say into the shot's running picture of the page.
 *
 * @param step the step that produced the reply, which is what decides how to read it
 * @param reply what the client answered
 * @param seen the accumulator, updated in place
 */
function absorb({ step, reply, seen }: { step: AimShotStep; reply: TerminalReply; seen: SeenSoFar }): void {
  if (reply.pageUrl !== null) {
    seen.liveUrl = reply.pageUrl;
  }
  if (CAPTURE_STEPS.has(step.what)) {
    seen.pictureUrls.push(reply.pageUrl);
  }
  if (step.what === "scroll-into-view") {
    seen.scroll = parseAimScroll({ stdout: reply.stdout });
  }
  if (step.what === "focus") {
    seen.focus = parseAimFocus({ stdout: reply.stdout });
  }
}

/**
 * Put the highlight away, and never report how that went.
 *
 * Called on the paths where something else has already failed, so its own failure has nothing to add — the
 * error being carried back is the one the caller has to act on, and replacing it with "and also the overlay
 * would not come down" would bury it.
 *
 * @param plan the element that was highlighted, if any
 * @param deps the client and the session it runs under
 * @param seams the browser calls the hide goes through
 */
function hideHighlight({
  plan,
  deps,
  seams,
}: {
  plan: AimShotPlan;
  deps: TerminalClientDeps;
  seams: AimShotSeams;
}): void {
  if (plan.ref === null) {
    return;
  }
  seams.client({ args: ["highlight", "--hide", plan.ref], deps });
}
