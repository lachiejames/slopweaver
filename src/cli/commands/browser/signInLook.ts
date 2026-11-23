/**
 * `browser sign-in`'s look at a wall page, and the tab it leaves behind: open a fresh tab on the wall's address or
 * look again through the tab a press left open, and let go of that tab, under the session's lock, once nothing is
 * left to do in it. Split from `./signInRun.ts` along that seam — the session plumbing here, the provider judgement
 * and the recording there.
 */
import { placementFromEnv } from "../../../browser/foreground.js";
import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";
import { removeInteractionSession } from "../../../browser/interactionSessionStore.js";
import { letGoOfBrowser } from "../../../browser/keepForeground.js";
import { holdBrowserSession } from "../../../browser/sessionLock.js";
import { type SignInProvider, sessionOpenedOnProvider } from "../../../browser/signInPress.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { openTab } from "./openTab.js";
import { claimLiveSession, fileLook, keptAliveDeps } from "./sessionHold.js";
import { clientDeps, liveSession, observe } from "./sessionShell.js";

/**
 * What one sign-in look knows about the owner's work Chrome, read from the store once at the verb's root: the home every
 * look is recorded under, the pin every client command runs under, and the account the recorded profile is signed
 * in as.
 */
export interface WorkChrome {
  readonly home: string;
  readonly pinPath: string;
  /** The only chooser row the fleet may press; undefined when Chrome names no account for the recorded profile. */
  readonly workEmail: string | undefined;
}

/** One look: whose Chrome, at which provider, through the tab a press left open if one is named, at which wall. */
export interface LookRequest {
  readonly chrome: WorkChrome;
  readonly provider: SignInProvider;
  readonly sessionId: string | undefined;
  readonly url: string;
}

/** A look's page, and the session whose tab it is on. */
export type Look = Result<{ observation: PageObservation; session: InteractionSession }>;

/**
 * Close a session's tab and drop its record, reporting a close that may have left the tab behind. Under the
 * session's lock, as a reap's idle let-go is, so the two never close one tab at once.
 *
 * @param chrome the work Chrome the tab is in
 * @param session the session whose tab is let go of
 */
export function closeSession({ chrome, session }: { chrome: WorkChrome; session: InteractionSession }): void {
  const { home } = chrome;
  const held = holdBrowserSession({ home, id: session.id, nowIso: new Date().toISOString() });
  if (held.isErr()) {
    logger.error({ msg: `browser sign-in: the look's tab was left to the process holding it: ${held.error}` });
    return;
  }
  try {
    const deps = clientDeps({ chromePinPath: chrome.pinPath, home, session });
    const problems = deps.isErr() ? deps.error : letGoOfBrowser({ deps: deps.value });
    removeInteractionSession({ home, id: session.id });
    for (const problem of problems) {
      logger.error({ msg: `browser sign-in: closing the look's tab: ${problem}` });
    }
  } finally {
    held.value.release();
  }
}

/**
 * Open a fresh tab on the wall's address and look at it once.
 *
 * @returns the look, or every problem met — having closed any tab it may have left
 */
function freshLook({ chrome, url }: { chrome: WorkChrome; url: string }): Look {
  const placement = placementFromEnv({ env: process.env });
  const opened = openTab({ chromePinPath: chrome.pinPath, home: chrome.home, placement, url });
  if (opened.isErr()) {
    if (opened.error.mayHoldTab !== undefined) {
      closeSession({ chrome, session: opened.error.mayHoldTab });
    }
    return err(opened.error.problems);
  }
  return ok(opened.value);
}

/**
 * Look again at the tab a press left open, where its page is NOW — the read `browser read` makes.
 *
 * A fresh tab on the wall's address shows the same button the fleet just pressed, so the look after a press has
 * to be the press's own tab: measured, five `pressable` GitHub rows in eleven minutes on
 * `/orgs/acme/sso` while the pressed tab sat on the organisation's Cloudflare Access login, and the card
 * asking the owner for that step was refused every time.
 *
 * The provider is checked on a read-only look at the record BEFORE the claim, because a claim touches it: a session
 * of another provider's, named here by mistake, is refused without its idle clock being reset.
 *
 * @returns the look, or why the session cannot be looked through
 */
function sessionLook({
  chrome,
  provider,
  sessionId,
  nowIso,
}: {
  chrome: WorkChrome;
  provider: SignInProvider;
  sessionId: string;
  nowIso: string;
}): Look {
  const { home } = chrome;
  const peek = liveSession({ home, nowIso, sessionId });
  if (peek.isErr()) {
    return err([peek.error.message]);
  }
  const { origins } = peek.value.session;
  if (!sessionOpenedOnProvider({ origins, provider })) {
    return err([
      `session ${sessionId} was opened on ${origins.join(", ")}, not a ${provider} sign-in — ` +
        `pass the session \`browser sign-in --provider ${provider}\` printed`,
    ]);
  }
  const live = claimLiveSession({ home, nowIso, sessionId });
  if (live.isErr()) {
    return err([live.error.message]);
  }
  const { session } = live.value;
  const deps = clientDeps({ chromePinPath: chrome.pinPath, home, session }).map((resolved) =>
    keptAliveDeps({ deps: resolved, home, sessionId }),
  );
  if (deps.isErr()) {
    return err(deps.error);
  }
  const observation = observe({ deps: deps.value, nowIso });
  if (observation.isErr()) {
    return err([observation.error.message]);
  }
  const filed = fileLook({
    home,
    notFiled: `the look at the sign-in page was not filed: session ${sessionId}'s latest look is unchanged`,
    nowIso,
    observation: observation.value,
    session,
  });
  if (filed.isErr()) {
    return err(filed.error);
  }
  return ok({ observation: observation.value, session });
}

/**
 * Take a look — through the named session's tab, else a fresh one on the wall's address.
 *
 * @param nowIso the instant the look is taken and recorded at, which a named session is judged and touched at
 * @returns the look, or why there is none
 */
export function takeLook({ chrome, provider, sessionId, url, nowIso }: LookRequest & { nowIso: string }): Look {
  if (sessionId === undefined) {
    return freshLook({ chrome, url });
  }
  return sessionLook({ chrome, nowIso, provider, sessionId });
}

/**
 * Let go of the press's tab once the sign-in it was for has gone through — nothing is left for the owner to do in it.
 *
 * @param chrome the work Chrome the tab is in
 * @param sessionId the tab a press left open, when the invocation named one
 */
export function closeNamedSession({ chrome, sessionId }: { chrome: WorkChrome; sessionId: string | undefined }): void {
  if (sessionId === undefined) {
    return;
  }
  const live = liveSession({ home: chrome.home, nowIso: new Date().toISOString(), sessionId });
  // Only a tab taken on GitHub's own sign-in is the press's; any other session named here is not this verb's.
  if (live.isOk() && sessionOpenedOnProvider({ origins: live.value.session.origins, provider: "github" })) {
    closeSession({ chrome, session: live.value.session });
  }
}
