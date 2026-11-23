/**
 * `slopweaver browser scroll` — moving the page a screen at a time and photographing each screen.
 *
 * Every decision is in `src/browser/scrollWalk.ts` and `./actionCore.ts`; this is the effectful shell, and
 * `./sessionShell.ts` is where it gets a live session and a look at the page.
 *
 * ## Whose decision this is
 *
 * A walk down a page is one screen at a time: scroll one page's worth, then look for the resource section.
 * That is a loop with a picture in
 * it, and it is this verb.
 */
import { join } from "node:path";

import { resolveBrowserPagePolicy } from "../../../admit/browserPagePolicy.js";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { admitBrowserAction } from "../../../browser/action.js";
import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import type { InteractionSession } from "../../../browser/interactionSession.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import {
  pageDelta,
  parseScrollPosition,
  SCROLL_POSITION_SOURCE,
  type ScrollPageStep,
  type ScrollPosition,
  scrollPicturePath,
} from "../../../browser/scrollWalk.js";
import { runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { captureScreenshot } from "../../../browser/viewportCapture.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type BrowserScrollOptions, renderScrollWalk } from "./actionCore.js";
import { claimLiveSession, fileLook, keptAliveDeps } from "./sessionHold.js";
import { fail, observe, pageWaiver, sessionClientDeps } from "./sessionShell.js";

/**
 * Run `browser scroll`: move the page a screen at a time, photographing each screen and saying where it is.
 *
 * The same loop, made one command: scroll one page's worth, then look.
 * `src/browser/scrollWalk.ts` decides the delta, the
 * overlap and what each screen reports; this is the shell that drives it.
 *
 * **Door-routed once for the whole walk, not once per screen.** A wheel is write-capable in this repository
 * (`src/browser/action.ts` says why), so this goes through the same door `act` does — and N rows for one
 * errand would bury the real writes exactly as a row per look would.
 *
 * **The walk ends with a READ, and that is a correctness rule rather than a courtesy.** Scrolling changes
 * what is on the page, so the session's last observation would otherwise describe the screen the walk
 * started on and every following `act` would be refused for citing a stale read.
 *
 * @param options the validated invocation
 * @param home the state home
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserScroll({
  options,
  home,
  profiles,
}: {
  options: BrowserScrollOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const nowIso = new Date().toISOString();
  const live = claimLiveSession({ home, nowIso, sessionId: options.sessionId });
  if (live.isErr()) {
    return fail({ problems: [live.error.message] });
  }
  // A walk has no ceiling on its screens, so every command claims the session again.
  const deps = (await sessionClientDeps({ home, profiles, session: live.value.session })).map((resolved) =>
    keptAliveDeps({ deps: resolved, home, sessionId: options.sessionId }),
  );
  if (deps.isErr()) {
    return fail({ problems: deps.error });
  }
  const seen = observe({ deps: deps.value, nowIso });
  if (seen.isErr()) {
    return fail({ problems: [seen.error.message] });
  }
  const url = seen.value.url;
  const waiver = pageWaiver({ home, nowIso, url });
  const admitted = admitBrowserAction({ kind: "scroll", nowIso: new Date().toISOString(), url, waiver });
  if (admitted.isErr()) {
    return fail({ problems: [admitted.error.message] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: doorLedgerPort(),
    perform: () => walkTheScroll({ deps: deps.value, home, nowIso, options, session: live.value.session, url }),
    request: {
      action: { kind: "verb", noun: "browser", verb: "scroll" },
      artifact: { do: "scroll", page: url, target: null },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver browser scroll", through: routed })) {
      logger.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  return routed.result;
}

/**
 * Whether the walk takes another screen after this one: only when this screen moved the page and the
 * requested number of screens has not been reached yet.
 *
 * @param moved whether the wheel on this screen changed the scroll position
 * @param page the 1-based screen just taken
 * @param pages how many screens the caller asked for
 * @returns `true` to take the next screen, `false` to stop here
 * @internal
 */
export function continueScrollWalk({ moved, page, pages }: { moved: boolean; page: number; pages: number }): boolean {
  return moved && page < pages;
}

/**
 * Move the page a screen at a time and photograph each screen — the door's own `perform` thunk.
 *
 * @param options the validated invocation
 * @param session the live session, whose workspace holds the pictures
 * @param deps the client and the session it runs under
 * @param url the page being walked, as the read above found it
 * @param nowIso the instant the walk began, which names the pictures
 * @param home the state home the session record is written under
 * @returns the process exit code
 */
function walkTheScroll({
  options,
  session,
  deps,
  url,
  nowIso,
  home,
}: {
  options: BrowserScrollOptions;
  session: InteractionSession;
  deps: TerminalClientDeps;
  url: string;
  nowIso: string;
  home: string;
}): number {
  const stem = join(session.workspace, `scroll-${nowIso.replaceAll(":", "-")}`);
  const steps: ScrollPageStep[] = [];
  for (let page = 1; page <= options.pages; page += 1) {
    const step = oneScreen({ deps, page, stem, up: options.up });
    if (step.isErr()) {
      return fail({ problems: [step.error.message] });
    }
    steps.push(step.value);
    if (!continueScrollWalk({ moved: step.value.moved, page, pages: options.pages })) {
      break;
    }
  }
  const settled = observe({ deps, nowIso: new Date().toISOString() });
  if (settled.isErr()) {
    return fail({ problems: [settled.error.message] });
  }
  // The page HAS scrolled, so a refusal here never reads as nothing having been done.
  const filed = fileLook({
    home,
    notFiled: `the scroll already happened, but its look was not filed: the session's latest look is unchanged — take a fresh \`browser read --session ${session.id}\``,
    nowIso,
    observation: settled.value,
    session,
  });
  if (filed.isErr()) {
    return fail({ problems: filed.error });
  }
  const policy = resolveBrowserPagePolicy({ url });
  if (options.json) {
    logger.out({ line: JSON.stringify({ page: settled.value, policy, steps, up: options.up }, null, 2) });
    return EXIT_OK;
  }
  const walk = renderScrollWalk({ observation: settled.value, policy, steps, up: options.up, url });
  for (const line of [...walk, ...filed.value]) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Move one screen and photograph where that left the page.
 *
 * The position is read BEFORE and AFTER the wheel, and the pair is what answers `moved`. Reading it only
 * afterwards could not tell the bottom of a document from a page that never moved — and a wheel acts on
 * whatever is under the pointer, so a page with an inner scroll region really does produce the second case.
 *
 * @param deps the client and the session it runs under
 * @param page the 1-based screen number, which names the picture
 * @param stem the path every picture of this walk is named from
 * @param up whether the walk is going up the page
 * @returns the screen, or the typed failure
 */
function oneScreen({
  deps,
  page,
  stem,
  up,
}: {
  deps: TerminalClientDeps;
  page: number;
  stem: string;
  up: boolean;
}): Result<ScrollPageStep, BrowserActionError> {
  const before = readScrollPosition({ deps });
  if (before.isErr()) {
    return err(before.error);
  }
  const wheeled = runClientCommand({
    args: ["mousewheel", "0", String(pageDelta({ position: before.value, up }))],
    deps,
    mayAct: true,
  });
  if (wheeled.isErr()) {
    return err(wheeled.error);
  }
  const after = readScrollPosition({ deps });
  if (after.isErr()) {
    return err(after.error);
  }
  const picturePath = scrollPicturePath({ page, stem });
  const photographed = captureScreenshot({ args: ["screenshot", `--filename=${picturePath}`], deps });
  if (photographed.isErr()) {
    return err(photographed.error);
  }
  return ok({ at: after.value, moved: after.value.y !== before.value.y, page, picturePath });
}

/**
 * Ask the page where it is.
 *
 * A reply that cannot be read is a FAILURE rather than a guess: the whole verb is an answer to "where am I
 * in this document", and a walk that reported a position nobody measured would be the confident lie the
 * pictures exist to prevent.
 *
 * @param deps the client and the session it runs under
 * @returns the position, or the typed failure
 */
function readScrollPosition({ deps }: { deps: TerminalClientDeps }): Result<ScrollPosition, BrowserActionError> {
  const reply = runClientCommand({ args: ["eval", SCROLL_POSITION_SOURCE], deps });
  if (reply.isErr()) {
    return err(reply.error);
  }
  const position = parseScrollPosition({ stdout: reply.value.stdout });
  if (position === null) {
    return err(
      BrowserActionErrors.clientFailed({
        detail: "the page did not answer where it is, so a scroll would have been taken blind",
      }),
    );
  }
  return ok(position);
}
