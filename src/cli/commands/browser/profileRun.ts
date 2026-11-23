/**
 * `slopweaver browser <profile|cookies|pin|shot|image-record>` — the effectful shell for the one browser lane.
 *
 * Every decision is in `./profileCore.ts` and, for the capture, `./shotCore.ts`; this file reads Chrome's own
 * profile index, the recorded choice under `$SLOPWEAVER_HOME`, and the cookie jar, and it writes the profile
 * pin. Three of the four sub-verbs launch nothing: `pin` WRITES a launcher and never runs it, which is the
 * whole point — a browser leg that does launch Chrome goes through that script, so it lands in the recorded
 * profile rather than the last-used one. See `docs/browser-route.md` for the ruling,
 * `docs/browser-route/brief-profile-and-walks.md` for why the pin exists, and `src/browser/profilePin.ts` for
 * the measurement.
 *
 * **`shot` is the one that drives it**, and it is the screenshot route for every session on this machine.
 * `./shotCore.ts` carries why it exists and what it deliberately cannot do.
 *
 * `cookies` runs in `./cookiesRun.ts`, which says why a cookie value never leaves the jar.
 */
import { listChromeProfiles } from "../../../browser/cookieJar.js";
import { RealChromeErrors } from "../../../browser/errors.js";
import { resolveChromePin } from "../../../browser/profilePin.js";
import {
  inertProfileFileLine,
  type RecordedProfileHome,
  readRecordedProfile,
  recordedProfilePort,
} from "../../../browser/recordedProfile.js";
import { datadogSiteRefusalFor } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { resolveActOptions, resolveAimOptions, resolveOpenOptions, resolveScrollOptions } from "./actionCore.js";
import { runBrowserAct, runBrowserAim } from "./actionRun.js";
import { runBrowserAnnotate } from "./annotateRun.js";
import { runBrowserClose } from "./closeRun.js";
import { runBrowserConsoleShot } from "./consoleShotRun.js";
import { runCookies } from "./cookiesRun.js";
import { browserVerbErrorLines } from "./errors.js";
import { runImageRecord } from "./imageRecordRun.js";
import { runInspect } from "./inspectRun.js";
import { runBreakGlass, runVerdicts } from "./journalRun.js";
import { runBrowserOpen } from "./openTab.js";
import { runPresentLive } from "./presentRun.js";
import {
  type BrowserOptions,
  type BrowserSubverb,
  parseBrowserArgs,
  recordedProfileLine,
  renderProfileList,
} from "./profileCore.js";
import { runBrowserRead } from "./readRun.js";
import { runBrowserRedact } from "./redactRun.js";
import { runBrowserScroll } from "./scrollRun.js";
import { runBrowserSessions } from "./sessionsRun.js";
import { resolveShotOptions } from "./shotCore.js";
import { runBrowserShot } from "./shotRun.js";
import { runSignIn } from "./signInRun.js";
import { runBrowserTerminalShot } from "./terminalShotRun.js";
import { BROWSER_USAGE } from "./usage.js";

/** What every sub-verb that reaches Chrome is handed: the flags, the home, and the recorded-profile door. */
type SessionVerbRequest = RecordedProfileHome & { readonly options: BrowserOptions };

/**
 * Run `browser profile`: list Chrome's own index, record one of them, or report the recorded choice.
 *
 * @param options the resolved invocation
 * @param home the state home whose store records the choice
 * @param profiles the door the recorded work profile is read and written through
 * @returns the process exit code
 */
async function runProfile({ options, home, profiles }: SessionVerbRequest): Promise<number> {
  const snapshot = await profiles.read({ home });
  if (snapshot.isErr()) {
    logger.error({ msg: snapshot.error.message });
    return EXIT_ERROR;
  }
  const inert = inertProfileFileLine({ snapshot: snapshot.value });
  if (inert !== undefined) {
    logger.warn({ msg: inert });
  }
  if (options.set !== undefined) {
    const expectedRevision = snapshot.value.revision;
    return recordProfile({ directory: options.set, expectedRevision, home, json: options.json, profiles });
  }
  const recorded = snapshot.value.directory;
  if (options.list) {
    return listProfiles({ json: options.json, recorded });
  }
  if (recorded === undefined) {
    logger.error({ msg: RealChromeErrors.profileUnset().message });
    return EXIT_ERROR;
  }
  logger.out({
    line: options.json
      ? JSON.stringify({ profileDirectory: recorded, revision: snapshot.value.revision }, null, 2)
      : `every browser leg reads your Chrome profile ${recorded} (the store's row, revision ${String(snapshot.value.revision)})`,
  });
  return EXIT_OK;
}

/**
 * Run `browser profile --list`: print Chrome's own index, marking the recorded choice.
 *
 * @param json whether machine-readable output was asked for
 * @param recorded the directory the store records; undefined when nothing is recorded yet
 * @returns the process exit code
 */
function listProfiles({ json, recorded }: { json: boolean; recorded: string | undefined }): number {
  const known = listChromeProfiles({ platform: process.platform });
  if (known.isErr()) {
    logger.error({ msg: known.error.message });
    return EXIT_ERROR;
  }
  if (json) {
    // JSON has no undefined, so an unrecorded choice is written as an explicit null.
    let recordedField: string | null = null;
    if (recorded !== undefined) {
      recordedField = recorded;
    }
    logger.out({ line: JSON.stringify({ profiles: known.value, recorded: recordedField }, null, 2) });
    return EXIT_OK;
  }
  logger.out({ line: "Chrome knows these profiles — record the one you work in with --set <directory>:" });
  for (const line of renderProfileList({ profiles: known.value, recorded })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Record one profile, refusing a directory Chrome does not list.
 *
 * Validated against Chrome's own index rather than written as typed, because a recorded name that does not
 * resolve fails much later and much less clearly — as "you are signed out of everything". The write is ONE
 * compare-and-set pinned to the revision this run read, never retried: a conflict means somebody else chose in
 * between, and which of the two is the work profile is not this verb's to decide.
 *
 * @param directory the directory name to record
 * @param expectedRevision the revision the read found; null when no row existed
 * @param json whether machine-readable output was asked for
 * @returns the process exit code
 */
async function recordProfile({
  directory,
  expectedRevision,
  home,
  json,
  profiles,
}: RecordedProfileHome & { directory: string; expectedRevision: number | null; json: boolean }): Promise<number> {
  const known = listChromeProfiles({ platform: process.platform });
  if (known.isErr()) {
    logger.error({ msg: known.error.message });
    return EXIT_ERROR;
  }
  const found = known.value.find((profile) => profile.directory === directory);
  if (found === undefined) {
    logger.error({
      msg:
        `Chrome lists no profile directory named ${directory}. It knows: ` +
        `${known.value.map((profile) => profile.directory).join(", ")}`,
    });
    return EXIT_USAGE;
  }
  const written = await profiles.record({ directory, expectedRevision, home });
  if (written.isErr()) {
    logger.error({ msg: written.error.message });
    return EXIT_ERROR;
  }
  // A successful compare-and-set always leaves a row, so a null revision here would be a register defect.
  logger.out({ line: recordedProfileLine({ json, profile: found, revision: written.value.revision! }) });
  return EXIT_OK;
}

/**
 * Run `browser pin`: (re)write the shim every Playwright connect page is launched through.
 *
 * The verb exists to inspect and repair, not to be remembered — `resolveChromePin` runs on every attach, so
 * a leg is never waiting on somebody having typed this.
 *
 * @param options the resolved invocation, for `--json`
 * @param home the state home the pin lives under, and whose store records the profile
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
async function runPin({ options, home, profiles }: SessionVerbRequest): Promise<number> {
  const paths = stateHomePaths({ home });
  const pinned = await resolveChromePin({ home, path: paths.chromePin, profiles });
  if (pinned.isErr()) {
    logger.error({ msg: pinned.error.message });
    return EXIT_ERROR;
  }
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    logger.error({ msg: directory.error.message });
    return EXIT_ERROR;
  }
  if (options.json) {
    logger.out({ line: JSON.stringify({ path: pinned.value, profileDirectory: directory.value }, null, 2) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `every Playwright connect page is launched through ${pinned.value}, which opens Chrome in ` +
      `${directory.value} whatever profile it was last used in`,
  });
  return EXIT_OK;
}

/**
 * Run `browser shot`: photograph one page through the relay, in the owner's own Chrome.
 *
 * The shot's own flags are validated HERE rather than in `parseBrowserArgs`, because they are meaningless
 * under the other three sub-verbs and folding them into the shared parser would make `--url` a thing
 * `browser profile` silently accepts.
 *
 * @param options the resolved invocation
 * @param home the state home the relay lease, the consent token and the recorded profile live under
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
async function runShot({ options, home, profiles }: SessionVerbRequest): Promise<number> {
  const shot = resolveShotOptions({
    caption: options.caption,
    home: options.home,
    json: options.json,
    out: options.out,
    raw: options.raw,
    readinessTimeout: options.readinessTimeout,
    settle: options.settle,
    target: options.target,
    url: options.url,
  });
  if (shot.isErr()) {
    for (const problem of shot.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: BROWSER_USAGE });
    return EXIT_USAGE;
  }
  const wrongSite = datadogSiteRefusalFor({
    command: "slopweaver browser shot",
    home,
    url: shot.value.url,
  });
  if (wrongSite !== undefined) {
    logger.error({ msg: wrongSite });
    return EXIT_ERROR;
  }
  return runBrowserShot({ home, options: shot.value, profiles });
}

/**
 * Run `browser open`: validate the address, then take an interaction session on it.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runOpen({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  const resolved = resolveOpenOptions({ json: options.json, url: options.url });
  if (resolved.isErr()) {
    return usage({ problems: resolved.error });
  }
  const wrongSite = datadogSiteRefusalFor({
    command: "slopweaver browser open",
    home,
    url: resolved.value.url,
  });
  if (wrongSite !== undefined) {
    logger.error({ msg: wrongSite });
    return EXIT_ERROR;
  }
  return runBrowserOpen({ home, options: resolved.value, profiles });
}

/**
 * Run `browser read`: look at a session's page.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runRead({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  if (options.session === undefined) {
    return usage({ problems: ["`browser read` needs --session <id>, as `slopweaver browser open` printed it"] });
  }
  const { find, json, under } = options;
  return runBrowserRead({ find, home, json, profiles, sessionId: options.session, under });
}

/**
 * Run `browser aim`: validate the element, then show it and photograph it without acting.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runAim({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  const resolved = resolveAimOptions({
    focus: options.focus,
    fullPage: options.fullPage,
    json: options.json,
    session: options.session,
    target: options.target,
  });
  if (resolved.isErr()) {
    return usage({ problems: resolved.error });
  }
  return runBrowserAim({ home, options: resolved.value, profiles });
}

/**
 * Run `browser scroll`: validate the walk, then move the page a screen at a time and photograph each.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runScroll({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  const resolved = resolveScrollOptions({
    json: options.json,
    pages: options.pages,
    session: options.session,
    up: options.up,
  });
  if (resolved.isErr()) {
    return usage({ problems: resolved.error });
  }
  return runBrowserScroll({ home, options: resolved.value, profiles });
}

/**
 * Run `browser act`: validate the interaction, then perform it and photograph the result.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runAct({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  const resolved = resolveActOptions({
    doKind: options.doKind,
    downloadDir: options.downloadDir,
    expectFocus: options.expectFocus,
    expectName: options.expectName,
    focus: !options.noFocus,
    fullPage: options.fullPage,
    json: options.json,
    observation: options.observation,
    out: options.out,
    session: options.session,
    target: options.target,
    value: options.value,
  });
  if (resolved.isErr()) {
    return usage({ problems: resolved.error });
  }
  return runBrowserAct({ home, options: resolved.value, profiles });
}

/**
 * Run `browser close`: let a session go.
 *
 * @param options the parsed flags
 * @param home the state home to drive against
 * @returns the process exit code
 */
function runClose({ options, home, profiles }: SessionVerbRequest): number | Promise<number> {
  if (options.session === undefined) {
    return usage({ problems: ["`browser close` needs --session <id>"] });
  }
  return runBrowserClose({ home, profiles, sessionId: options.session });
}

/**
 * Print usage problems and answer the usage exit code.
 *
 * @param problems what was wrong with the invocation
 * @returns the process exit code
 */
function usage({ problems }: { problems: readonly string[] }): number {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
  logger.error({ msg: BROWSER_USAGE });
  return EXIT_USAGE;
}

/**
 * Run the `browser` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runBrowser(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: [] });
  if (rest.length === 0 || rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BROWSER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseBrowserArgs({ rest });
  if (parsed.isErr()) {
    return usage({ problems: browserVerbErrorLines({ error: parsed.error }) });
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  // A table rather than a ladder of ifs: twelve sub-verbs is where a chain stops being reviewable, and the
  // `cognitive-complexity` gate says so in the same breath. Every entry answers a promise or a number, the
  // synchronous ones simply already resolved. The recorded-profile door is built once, here, and every arm
  // that reaches Chrome reads the work profile through it — the store row, never a file.
  const profiles = recordedProfilePort();
  // `parseBrowserArgs` refuses redact and terminal-shot without --form, so the assertion cannot be reached empty.
  const formVerb = { capturedAtIso: new Date().toISOString(), form: options.form!, home, json: options.json };
  const arms: Readonly<Record<BrowserSubverb, () => number | Promise<number>>> = {
    act: () => runAct({ home, options, profiles }),
    aim: () => runAim({ home, options, profiles }),
    // `parseBrowserArgs` refuses this sub-verb without --form, so the assertion cannot be reached empty.
    annotate: () => runBrowserAnnotate({ form: options.form!, home, json: options.json }),
    "break-glass": () => runBreakGlass({ home, options }),
    close: () => runClose({ home, options, profiles }),
    "console-shot": () => runBrowserConsoleShot({ capturedAtIso: formVerb.capturedAtIso, home, options }),
    cookies: () => runCookies({ home, options, profiles }),
    inspect: () => runInspect({ home, profiles, url: options.url }),
    // `parseBrowserArgs` refuses this sub-verb without --form, so the assertion cannot be reached empty.
    "image-record": () => runImageRecord({ form: options.form!, home, json: options.json }),
    open: () => runOpen({ home, options, profiles }),
    pin: () => runPin({ home, options, profiles }),
    present: () =>
      runPresentLive({ destination: options.destination, home, page: options.page, profiles, url: options.url }),
    "sign-in": () =>
      runSignIn({ home, org: options.org, profiles, provider: options.provider, sessionId: options.session }),
    profile: () => runProfile({ home, options, profiles }),
    read: () => runRead({ home, options, profiles }),
    redact: () => runBrowserRedact(formVerb),
    scroll: () => runScroll({ home, options, profiles }),
    sessions: () => runBrowserSessions({ home, json: options.json }),
    shot: () => runShot({ home, options, profiles }),
    "terminal-shot": () => runBrowserTerminalShot(formVerb),
    verdicts: () => runVerdicts({ home, options }),
  };
  return arms[options.subverb]();
}

export const browserCommand = defineCommand({ run: runBrowser });
