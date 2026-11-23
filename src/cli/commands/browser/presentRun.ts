/**
 * `slopweaver browser present` — take the owner to one page in their own Chrome and leave the tab open; a Slack message
 * permalink goes to the owner's Slack desktop app instead and opens no tab (`./presentSlackApp.ts`), and a console page — a
 * published local page or a console address — opens as a tab in the Slopweaver desktop app
 * (`../../../browser/presentDesktop.ts`). The effectful
 * shell over `src/browser/present.ts`, which decides what may be opened; the opening itself is `openTab`, the
 * same one `browser open` takes, so there is one attach-and-goto and one session record.
 */

import { realForegroundRun } from "../../../browser/foreground.js";
import { landingProblem } from "../../../browser/inspect.js";
import type { InteractionSession } from "../../../browser/interactionSession.js";
import { removeInteractionSession } from "../../../browser/interactionSessionStore.js";
import { releaseInBackground } from "../../../browser/keepForeground.js";
import { ATTACH_TIMEOUT_MS } from "../../../browser/lookBudget.js";
import {
  landingHost,
  offSiteDatadogHost,
  type PresentTarget,
  pageStayedPut,
  presentAnswer,
  type SlackDesktopAnswer,
  slackDesktopHandoff,
  slackHandoffAnswer,
} from "../../../browser/present.js";
import {
  type DesktopPageSeam,
  openConsolePathInDesktop,
  realDesktopPageSeam,
} from "../../../browser/presentDesktop.js";
import { isPresentPagesError, resolvePresentOverStore } from "../../../browser/presentPublished.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import { underSessionLock } from "../../../browser/sessionLock.js";
import { runClientCommand, type TerminalClientDeps } from "../../../browser/terminalClient.js";
import { datadogSiteHatchRefusal, datadogSiteRefusal } from "../../../datadog/siteGuard.js";
import { datadogSite, withDatadogSite } from "../../../datadog/source.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { logger } from "../../../lib/logger.js";
import { type PublishedAmong, publishedAmongInStore } from "../../../pages/published.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type OpenTabFailure, openTab } from "./openTab.js";
import { realSlackAppSeam, type SlackAppSeam, slackAppOpening } from "./presentSlackApp.js";
import { keptAliveDeps } from "./sessionHold.js";
import { clientDeps, fail, observe, resolveSessionPin } from "./sessionShell.js";

/**
 * How long one client command other than the attach may take here: the cap `browser inspect` measured, for the same
 * reason — the console's browser budget (`site/lib/talkToolsList.ts`) must never be what kills a present mid-command.
 * The attach takes `ATTACH_TIMEOUT_MS`, because a 6 s kill mid-attach is what left "Failed to connect to MCP relay"
 * in front of the owner (`commandTimeoutFor`), and the closing commands of a refused landing take this cap too. The worst
 * case is the same commands `browser inspect` runs, so `BUDGETED_LOOK_WORST_CASE_MS`
 * (`src/browser/lookBudget.ts`) covers it.
 */
const PRESENT_COMMAND_TIMEOUT_MS = 6_000;

/** The state home a tab's record lives under, and the profile pin the present resolved from the recorded profile. */
interface PinnedHome {
  readonly home: string;
  readonly chromePinPath: string;
}

/**
 * Close a tab this present opened and will not leave, forgetting its record once the close is known clean.
 *
 * A close is fallible — a relay can drop between the look and the close — and a close that fails leaves BOTH the
 * record and the named client session standing, so `browser close --session` can finish it. It is tried ONCE: a
 * `tab-close` that timed out may still have closed the tab, and a second one would close whatever is current by
 * then, which is the owner's. Neither failure is reported in the client's own words, which can
 * carry the page's text. That is the whole guarantee: a tab that landed somewhere refused was on screen until
 * this ran, the same post-navigation limit `browser inspect` states — where a page lands is only known once it has.
 *
 * @param home the state home the session record lives under
 * @param session the session holding the tab
 * @param chromePinPath the profile pin script the present resolved from the recorded profile
 * @returns one line saying the tab was closed, or what went wrong closing it and how to finish the job
 */
function closeTab({ home, session, chromePinPath }: PinnedHome & { session: InteractionSession }): readonly string[] {
  const stillOpen = `the tab may still be open — slopweaver browser close --session ${session.id}, or close it by hand`;
  const deps = clientDeps({ chromePinPath, home, session });
  if (deps.isErr()) {
    return [...deps.error, stillOpen];
  }
  // Rebuilt from the record, so it does not carry the open's cap: without it each closing command would get the
  // client's own minute and the console's browser budget could kill the close itself.
  const capped: TerminalClientDeps = { ...deps.value, commandTimeoutMs: PRESENT_COMMAND_TIMEOUT_MS };
  // A close can move the owner's foreground as an attach does, so it is given back whichever way the close ends
  // (`../../../browser/keepForeground.ts`). Under the session's lock, as every closer is,
  // so it never lands while another command acts through the tab.
  const closed = underSessionLock({
    act: () =>
      releaseInBackground({
        release: () => closeThrough({ deps: capped, home, session, stillOpen }),
        run: realForegroundRun,
      }),
    home,
    sessionId: session.id,
  });
  if (closed.isErr()) {
    return [closed.error.message, stillOpen];
  }
  return closed.value;
}

/* The close itself: the client commands and the record, once `closeTab` has resolved the client. */
function closeThrough({
  deps,
  home,
  session,
  stillOpen,
}: {
  deps: TerminalClientDeps;
  home: string;
  session: InteractionSession;
  stillOpen: string;
}): readonly string[] {
  // `letGoOfBrowser`'s three commands, split: a detach runs ONLY once the tab is known closed. `letGoOfBrowser`
  // always runs both, and a detach after a failed close tears down the one named client session `browser close`
  // could retry through, leaving a listed record whose tab nothing can reach. Nor is
  // it called after a clean close: its second `tab-close` would close whatever tab is current by then — the owner's.
  runClientCommand({ args: ["highlight", "--hide"], deps });
  const closed = runClientCommand({ args: ["tab-close"], deps, mayAct: true });
  if (closed.isErr()) {
    return ["the tab could not be closed", stillOpen];
  }
  const said = ["the tab it opened was closed again"];
  // The tab is gone, so the client is let go of whatever happens to the record: a record left behind with its
  // client still attached would send a later `browser close`'s `tab-close` at whatever tab is current — the owner's.
  const detached = runClientCommand({ args: ["detach"], deps, mayAct: true });
  if (detached.isErr()) {
    said.push("the client session could not be detached");
  }
  try {
    removeInteractionSession({ home, id: session.id });
  } catch {
    said.push(`its record ${session.id} could not be removed; the tab is already closed, so it needs no browser close`);
  }
  return said;
}

/**
 * The Datadog refusal for one address: the shared site guard's, else `present`'s own stricter host check, both
 * behind the guard's one hatch.
 *
 * @param url the address about to be opened, or where a page landed
 * @param home the state home whose profile names this install's Datadog site
 * @returns the four-line refusal, or `undefined` to allow
 */
function presentSiteRefusal({ url, home }: { url: string; home: string }): string | undefined {
  const command = "slopweaver browser present";
  const shared = datadogSiteRefusal({ command, env: withDatadogSite({ env: process.env, home }), url });
  if (shared !== undefined) {
    return shared;
  }
  return datadogSiteHatchRefusal({
    command,
    detail: offSiteDatadogHost({ ddSite: datadogSite({ home }), url }),
    env: process.env,
  });
}

/**
 * What a present that did not finish says, closing the tab it may have opened: a `goto` that failed may already
 * have followed a redirect, and the tab would otherwise STAY wherever it went.
 *
 * @param failure why `openTab` did not finish
 * @param home the state home the session record lives under
 * @param chromePinPath the profile pin script the present resolved from the recorded profile
 * @returns the problem lines to fail with
 */
function unfinishedProblems({
  failure,
  home,
  chromePinPath,
}: PinnedHome & { failure: OpenTabFailure }): readonly string[] {
  const { problems, mayHoldTab, navigated, notFiled } = failure;
  if (mayHoldTab === undefined) {
    return problems;
  }
  // Once `goto` was sent, the client's words can carry the page's own text (`OpenTabFailure.navigated`), and
  // this page has not yet been judged against the landing rules — so they are withheld. A
  // not-filed line is this code's own words, so it is kept.
  let said = problems;
  if (navigated) {
    const own = notFiled === undefined ? [] : [notFiled];
    said = [
      "the page did not finish opening, and the browser client's own words are withheld because they can carry the page's text",
      ...own,
    ];
  }
  return [...said, ...closeTab({ chromePinPath, home, session: mayHoldTab })];
}

/**
 * When an open that did not finish was Slack handing a message link to the owner's desktop app (`slackDesktopHandoff` holds
 * the measurement), the answer that says so, the handoff tab closed once; otherwise `undefined`, and nothing has been
 * closed, so the caller's `unfinishedProblems` is still the one close. Only a failure after `goto` with a tab held is
 * looked at, and the look stays here: none of the page's elements, paths or the client's words reach the answer.
 *
 * @param failure why `openTab` did not finish
 * @param requestedUrl the address the present opened
 * @param home the state home the session record lives under
 * @param chromePinPath the profile pin script the present resolved from the recorded profile
 * @returns the handoff answer, or `undefined` when this was not one
 */
function slackHandoff({
  failure,
  requestedUrl,
  home,
  chromePinPath,
}: {
  failure: OpenTabFailure;
  requestedUrl: string;
  home: string;
  chromePinPath: string;
}): SlackDesktopAnswer | undefined {
  const session = failure.mayHoldTab;
  if (!failure.navigated || session === undefined) {
    return undefined;
  }
  const deps = clientDeps({ chromePinPath, home, session });
  if (deps.isErr()) {
    return undefined;
  }
  // The open's cap, restored: `clientDeps` rebuilds from the record, and an uncapped look could outlast the console's
  // browser budget (`PRESENT_COMMAND_TIMEOUT_MS`).
  const capped: TerminalClientDeps = { ...deps.value, commandTimeoutMs: PRESENT_COMMAND_TIMEOUT_MS };
  const look = observe({
    deps: keptAliveDeps({ deps: capped, home, sessionId: session.id }),
    nowIso: new Date().toISOString(),
  });
  if (look.isErr()) {
    return undefined;
  }
  if (!slackDesktopHandoff({ landed: look.value.url, requested: requestedUrl, title: look.value.title })) {
    return undefined;
  }
  // A first look that was not filed is said here too: a close that fails leaves the session open behind the answer.
  const own = failure.notFiled === undefined ? [] : [failure.notFiled];
  return slackHandoffAnswer({ cleanup: [...closeTab({ chromePinPath, home, session }), ...own], requestedUrl });
}

/**
 * Why a page may not stay where it LANDED, held to both rules the address was: the browser register, and this
 * install's own Datadog console — a redirect from an allowed page to another site's console must not stay open
 * either. Judged on the whole address; NAMED by its host alone (`landingHost` says why).
 *
 * @param url where the page settled, as the look read it
 * @param home the state home whose profile names this install's Datadog site
 * @returns the refusal, or `undefined` when the page may stay
 */
function landingRefusal({
  url,
  target,
  home,
}: {
  url: string;
  target: PresentTarget;
  home: string;
}): string | undefined {
  if (target.requestedAs === "page" || target.requestedAs === "console") {
    if (pageStayedPut({ landed: url, requested: target.url })) {
      return undefined;
    }
    return `the page redirected to ${landingHost({ url })}, off the console page it was opened as, so what it showed is withheld`;
  }
  if (landingProblem({ url }) !== undefined) {
    return `the page redirected to ${landingHost({ url })}, off the browser register, so what it showed is withheld`;
  }
  const landedSite = presentSiteRefusal({ home, url });
  if (landedSite !== undefined) {
    return `the page redirected to another Datadog site's console — ${landedSite}`;
  }
  return undefined;
}

/**
 * `runPresent` over the live seams: the installed desktop app and the owner's Slack desktop app, each reached through `open`
 * run synchronously.
 *
 * @param request the parsed flags, the state home and the recorded-profile door
 * @returns the process exit code
 */
export async function runPresentLive(
  request: Omit<Parameters<typeof runPresent>[0], "desktopPage" | "publishedAmong" | "slackApp">,
): Promise<number> {
  return runPresent({
    ...request,
    desktopPage: realDesktopPageSeam({ run: realForegroundRun }),
    slackApp: realSlackAppSeam({ home: request.home }),
    publishedAmong: publishedAmongInStore,
  });
}

/**
 * Run `browser present` from the parsed flags: resolve the page, refuse a wrong Datadog site, open a Slack message
 * permalink in the owner's Slack desktop app, and anything else in their Chrome (`presentInBrowser`).
 *
 * @param destination the raw `--destination` value
 * @param url the raw `--url` value
 * @param page the raw `--page` value, a local page's slug
 * @param home the state home the session record lives under, and the pages a `--page` must be published in
 * @param slackApp the seam that opens a Slack message permalink in the owner's Slack desktop app (`realSlackAppSeam`)
 * @param profiles the door the recorded work profile is read through, once the page is bound for the owner's Chrome
 * @param desktopPage the seam a local page opens through as a desktop-app tab (`realDesktopPageSeam`)
 * @param publishedAmong asks the store which named pages are published (`publishedAmongInStore`)
 * @returns the process exit code
 */
export async function runPresent({
  destination,
  url,
  page,
  home,
  slackApp,
  profiles,
  desktopPage,
  publishedAmong,
}: {
  destination: string | undefined;
  url: string | undefined;
  page: string | undefined;
  home: string;
  slackApp: SlackAppSeam;
  profiles: RecordedProfilePort;
  desktopPage: DesktopPageSeam;
  publishedAmong: PublishedAmong;
}): Promise<number> {
  const target = await resolvePresentOverStore({
    consoleBase: consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
    ddSite: datadogSite({ home }),
    publishedAmong: ({ slugs }) => publishedAmong({ home, slugs }),
    request: { destination, page, url },
  });
  if (target.isErr()) {
    // The message alone, no usage block: the console voice reads the last lines of stderr, and a refusal it can
    // act on is worth more to it than forty lines of flags. A store that cannot say is an error, not the caller's.
    logger.error({ msg: target.error.message });
    return isPresentPagesError(target.error) ? EXIT_ERROR : EXIT_USAGE;
  }
  // A console page — a briefing, a card's page, the Queue, a Settings section — is a new tab in the desktop app,
  // never the owner's Chrome, wherever the app is.
  if (target.value.requestedAs === "page" || target.value.requestedAs === "console") {
    const { deepLink, path, url: requestedUrl } = target.value;
    const inDesktop = openConsolePathInDesktop({ deepLink, path, requestedUrl, seam: desktopPage });
    if (inDesktop.isErr()) {
      return fail({ problems: [inDesktop.error.message] });
    }
    if (inDesktop.value !== undefined) {
      logger.out({ line: JSON.stringify(inDesktop.value) });
      return EXIT_OK;
    }
  }
  const wrongSite = presentSiteRefusal({ home, url: target.value.url });
  if (wrongSite !== undefined) {
    logger.error({ msg: wrongSite });
    return EXIT_ERROR;
  }
  const inSlackApp = await slackAppOpening({ slackApp, target: target.value });
  if (inSlackApp !== undefined) {
    logger.out({ line: JSON.stringify(inSlackApp) });
    return EXIT_OK;
  }
  const pin = await resolveSessionPin({ home, profiles });
  if (pin.isErr()) {
    return fail({ problems: pin.error });
  }
  return presentInBrowser({ chromePinPath: pin.value, home, target: target.value });
}

/**
 * Open the resolved page in the owner's Chrome, read Slack's own desktop handoff page as opened, and refuse — closing the
 * tab again — a page that LANDED somewhere the address rules would not have opened.
 *
 * @param target the resolved page, already cleared of a wrong Datadog site
 * @param home the state home the session record lives under
 * @param chromePinPath the profile pin script resolved from the recorded profile
 * @returns the process exit code
 */
function presentInBrowser({
  target,
  home,
  chromePinPath,
}: {
  target: PresentTarget;
  home: string;
  chromePinPath: string;
}): number {
  // Taking the owner to a page IS showing it, so `present` is the one opener that never puts the owner's window back over its own.
  const opened = openTab({
    attachTimeoutMs: ATTACH_TIMEOUT_MS,
    chromePinPath,
    commandTimeoutMs: PRESENT_COMMAND_TIMEOUT_MS,
    home,
    placement: "foreground",
    url: target.url,
  });
  if (opened.isErr()) {
    const handedOff = slackHandoff({ chromePinPath, failure: opened.error, home, requestedUrl: target.url });
    if (handedOff !== undefined) {
      logger.out({ line: JSON.stringify(handedOff) });
      return EXIT_OK;
    }
    return fail({ problems: unfinishedProblems({ chromePinPath, failure: opened.error, home }) });
  }
  const { observation, session } = opened.value;
  const refused = landingRefusal({ home, target, url: observation.url });
  if (refused !== undefined) {
    return fail({ problems: [refused, ...closeTab({ chromePinPath, home, session })] });
  }
  const answer = presentAnswer({
    requestedUrl: target.url,
    session: session.id,
    title: observation.title,
    url: observation.url,
  });
  logger.out({ line: JSON.stringify(answer) });
  return EXIT_OK;
}
