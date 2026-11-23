/**
 * Reaching a live interaction session, and taking one LOOK at the page it is on — the plumbing every
 * `slopweaver browser` sub-verb that drives a session starts from.
 *
 * A file of its own rather than private to one verb, because `read`, `aim`, `act`, `scroll` and `close` all
 * begin the same three ways: resolve the consent token and the profile pin, load the session record and
 * judge whether it is still live, and photograph and snapshot what is in front of the browser. Keeping one
 * copy of that is what stops two verbs disagreeing about what "a look" is — and the look is now a picture as
 * well as a list of elements, which is exactly the kind of change that would otherwise land in one verb.
 *
 * Holding a session under its lock while a verb acts through it — the claim, the per-command touch, filing a
 * look and closing a one-shot one — is `./sessionHold.ts`.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import { activeBrowserPageWaiver } from "../../../browser/breakGlass.js";
import { readBrowserBreakGlassGrants } from "../../../browser/breakGlassStore.js";
import { browserErrorLines } from "../../../browser/browserErrors.js";
import { readExtensionToken } from "../../../browser/extensionToken.js";
import { type InteractionSession, type PageObservation, sessionIsLive } from "../../../browser/interactionSession.js";
import { readInteractionSession } from "../../../browser/interactionSessionStore.js";
import { settlePage } from "../../../browser/pageSettleRun.js";
import { resolveChromePin } from "../../../browser/profilePin.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { captureScreenshot } from "../../../browser/viewportCapture.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { sleepSync } from "../../../lib/sleepSync.js";
import { stateHomePaths } from "../../../stateHome.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/**
 * The agent session a receipt and a waiver are keyed to.
 *
 * The SAME variable `browser break-glass` keys a grant to (`./journalRun.ts`), read through the same
 * constant rather than spelled again — a waiver recorded under one name and looked up under another would
 * silently never match, which is the whole class `one-normalisation-decides-identity` names.
 *
 * @param readSessionId how the session id is read, the process environment unless a test passes a fake
 * @returns the session id, or a constant standing for "no session named itself", which no waiver is ever
 * issued to
 */
export function ownerSessionId({
  readSessionId = () => process.env[CLAUDE_CODE_SESSION_ID_ENV],
}: {
  readSessionId?: () => string | undefined;
} = {}): string {
  const named = readSessionId();
  if (named === undefined) {
    return "unknown-session";
  }
  return named;
}

/**
 * Resolve the profile pin a session-driving verb runs under, once, at the verb's root.
 *
 * @param home the state home whose store records the work profile
 * @param profiles the door the recorded work profile is read through
 * @returns the pin script's path, or the one line saying why there is none
 */
export async function resolveSessionPin({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<string>> {
  const pin = await resolveChromePin({ home, path: stateHomePaths({ home }).chromePin, profiles });
  if (pin.isErr()) {
    return err([pin.error.message]);
  }
  return ok(pin.value);
}

/**
 * Resolve the pin, then everything else the client needs — for a verb whose root IS the look, so there is
 * nowhere above it to resolve the pin once.
 *
 * @param home the state home the consent token lives under, and whose store records the profile
 * @param session the interaction session the client runs under
 * @param profiles the door the recorded work profile is read through
 * @returns the deps, or every reason there are none
 */
export async function sessionClientDeps({
  home,
  session,
  profiles,
}: {
  home: string;
  session: InteractionSession;
  profiles: RecordedProfilePort;
}): Promise<Result<TerminalClientDeps>> {
  const pin = await resolveSessionPin({ home, profiles });
  if (pin.isErr()) {
    return err(pin.error);
  }
  return clientDeps({ chromePinPath: pin.value, home, session });
}

/**
 * Resolve everything the client needs to reach the owner's browser.
 *
 * The profile pin arrives RESOLVED: the recorded profile is a store row, so reading it is asynchronous, and the
 * verb's own root resolves it once ({@link resolveSessionPin}) rather than every synchronous look below it.
 *
 * @param home the state home the consent token lives under
 * @param session the interaction session the client runs under
 * @param chromePinPath the profile pin script the verb's root resolved from the recorded profile
 * @returns the deps, or every reason there are none
 */
export function clientDeps({
  home,
  session,
  chromePinPath,
}: {
  home: string;
  session: InteractionSession;
  chromePinPath: string;
}): Result<TerminalClientDeps> {
  const token = readExtensionToken({ home });
  if (token.isErr()) {
    return err(browserErrorLines({ error: token.error }));
  }
  return ok({
    chromePinPath,
    clientSession: session.clientSession,
    extensionToken: token.value,
    placement: session.placement,
    workspace: session.workspace,
  });
}

/**
 * Take one look at the page: its elements, and a picture of what is on screen.
 *
 * **Two commands, and the picture is the second half of the rule rather than a nicety.** A browser works well because
 * every move shows its result, and every act instantly shows the result of that action.
 * A snapshot is a list of
 * elements — it is not what is on the screen, and a session that reads only one is choosing its next click
 * without ever having seen the page. So every look photographs the VIEWPORT, which costs one client round
 * trip and is what makes `open` answer the first screenshot a reader expects: what is on the page.
 *
 * **It waits for the page to finish drawing first.** MEASURED on the owner's own Chrome: an `open` on
 * Datadog's APM console came back `title: (untitled)` with a screenshot that was pure white, because the
 * client's `goto` resolves on the load event and a single-page application renders after it.
 * `src/browser/pageSettle.ts` carries the whole account and the budget.
 *
 * **A picture that fails does NOT fail the look.** The elements are what an action is aimed by and the
 * picture is what a reader judges by; a look that answered nothing because a screenshot could not be written
 * would refuse an errand over its evidence. The observation records `null` and says so instead.
 *
 * **Nor does a picture of another page join it.** The snapshot and the screenshot are two client commands, so a
 * redirect between them leaves a picture of a page the elements and URL are not about. That picture is
 * withheld exactly as a failed one is (`pictureIsOfThisLook`), so a filed look never disagrees with itself.
 *
 * @param deps the client and the session it runs under
 * @param nowIso the instant the look was taken
 * @returns the observation, or why the page could not be read
 */
export function observe({
  deps,
  nowIso,
}: {
  deps: TerminalClientDeps;
  nowIso: string;
}): Result<PageObservation, BrowserActionError> {
  settlePage({
    deps,
    sleep: (ms) => {
      sleepSync({ ms });
    },
  });
  const reply = runClientCommand({ args: ["snapshot"], deps });
  if (reply.isErr()) {
    return err(reply.error);
  }
  const id = randomUUID();
  const picture = join(deps.workspace, `look-${id}.png`);
  const photographed = captureScreenshot({ args: ["screenshot", `--filename=${picture}`], deps });
  let screenshotPath: string | null = null;
  if (
    photographed.isOk() &&
    pictureIsOfThisLook({ lookUrl: reply.value.pageUrl, picturedUrl: photographed.value.pageUrl })
  ) {
    screenshotPath = picture;
  }
  // The client emits its accessibility snapshot in BOTH shapes and which one you get is its choice, not
  // yours — MEASURED: a small page comes back as an inline ```yaml fence, and a large one (the
  // JumpCloud console, for instance) comes back as `- [Snapshot](.playwright-cli/page-….yml)` naming a file
  // the client already wrote. Taking the file when there is one, and filing the inline text when there is
  // not, is what stops an `elements:` line pointing at a one-byte file nobody could aim by.
  const written = reply.value.snapshotPath;
  const snapshotPath = written === null ? join(deps.workspace, `observation-${id}.yml`) : join(deps.workspace, written);
  if (written === null) {
    const inline = reply.value.snapshotYaml;
    // A page that rendered nothing aimable is filed as saying so, rather than as an empty file: the next
    // `act` reads this to find a ref, and an empty one reads as "the read failed" instead of "look again".
    let elements = "(the page rendered no accessible elements)";
    if (inline !== null) {
      elements = inline;
    }
    try {
      writeFileSync(snapshotPath, `${elements}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      return err(BrowserActionErrors.observationUnusable({ because: "elements-unfiled" }));
    }
  }
  const url = reply.value.pageUrl;
  if (url === null) {
    return err(BrowserActionErrors.observationUnusable({ because: "no-page" }));
  }
  const pageTitle = reply.value.pageTitle;
  let title = "(untitled)";
  if (pageTitle !== null) {
    title = pageTitle;
  }
  return ok({ id, observedAtIso: nowIso, screenshotPath, snapshotPath, title, url });
}

/**
 * Whether a look's picture shows the page its snapshot read: a screenshot reply naming ANOTHER page is of a page
 * that moved in between. What it does NOT close: a reply naming no page leaves the picture standing — the
 * behaviour before this check — because whether the client names a page on a screenshot reply is unmeasured,
 * and withholding on absence could strip the picture from every look. A live capture of one screenshot reply
 * settles it; then this returns `false` on `null` too.
 *
 * @param lookUrl the page the snapshot reply named
 * @param picturedUrl the page the screenshot reply named
 * @returns `false` only when both named a page and the two differ
 */
export function pictureIsOfThisLook({
  lookUrl,
  picturedUrl,
}: {
  lookUrl: string | null;
  picturedUrl: string | null;
}): boolean {
  return lookUrl === null || picturedUrl === null || lookUrl === picturedUrl;
}

/**
 * Load a live session, or say why there is none to act through. Reads only: a verb that will act through the
 * tab takes it with `claimLiveSession` (`./sessionHold.ts`) instead.
 *
 * @param home the state home
 * @param sessionId the id the caller named
 * @param nowIso the instant to judge liveness against
 * @returns the session and its latest observation, or the problems to print
 */
export function liveSession({
  home,
  sessionId,
  nowIso,
}: {
  home: string;
  sessionId: string;
  nowIso: string;
}): Result<{ readonly session: InteractionSession; readonly observation: PageObservation | null }, BrowserActionError> {
  const stored = readInteractionSession({ home, id: sessionId });
  if (stored === undefined) {
    return err(BrowserActionErrors.sessionLost({ sessionId }));
  }
  if (!sessionIsLive({ nowIso, session: stored.session })) {
    return err(BrowserActionErrors.sessionIdle({ sessionId }));
  }
  return ok({ observation: stored.observation, session: stored.session });
}

/**
 * The scoped waiver this session holds for this exact page, when it holds one.
 *
 * @param home the state home
 * @param url the page an action is aimed at
 * @param nowIso the instant to judge expiry against
 * @returns the waiver, or `undefined`
 */
export function pageWaiver({
  home,
  url,
  nowIso,
}: {
  home: string;
  url: string;
  nowIso: string;
}): { readonly url: string; readonly reason: string; readonly expiresAtIso: string } | undefined {
  const grant = activeBrowserPageWaiver({
    grants: readBrowserBreakGlassGrants({ home }),
    nowIso,
    sessionId: ownerSessionId(),
    url,
  });
  return grant === undefined ? undefined : { expiresAtIso: grant.expiresAtIso, reason: grant.reason, url };
}

/**
 * Print every problem and answer the failing exit code.
 *
 * @param problems what went wrong
 * @returns the process exit code
 */
export function fail({ problems }: { problems: readonly string[] }): number {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
  return EXIT_ERROR;
}
