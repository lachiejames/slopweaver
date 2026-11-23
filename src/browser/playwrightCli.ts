/**
 * The real {@link BrowserPageTransport}: Playwright driving the owner's OWN Chrome, through the
 * Playwright Extension relay that `playwright-core` already ships.
 *
 * ## No new dependency, no launched browser, no second profile
 *
 * `playwright-core` — already installed — ships a terminal client at
 * `lib/tools/cli-client/program`, whose `attach --extension=<channel>` resolves Chrome's DEFAULT user-data
 * directory and connects over a CDP relay the installed extension speaks. Nothing here launches a browser,
 * supplies a user-data directory, or opens a second or debug profile; `docs/browser-route.md` is the ruling
 * and `no-private-browser-profile` in `yarn lint` is the gate. What this module starts is a CLIENT of a
 * browser the owner is already running.
 *
 * ## It launches Chrome through the PROFILE PIN, never bare
 *
 * The relay's own launch names no profile at all — MEASURED, and reproduced in `./profilePin.ts` — so Chrome
 * puts the connect page in whichever profile it was last used in, the owner's personal one included. Every client
 * this module starts therefore carries `PLAYWRIGHT_MCP_EXECUTABLE_PATH` pointing at the pin, which execs the
 * same Chrome with `--profile-directory` already in front. `chromePinPath` is a REQUIRED dependency for
 * exactly that reason: there is no shape of this transport that can forget it.
 *
 * ## A walk closes the tab it opened
 *
 * The relay's shared context is ONE tab — the `connect.html` page the attach opened — and a visit navigates
 * it, so a finished walk otherwise leaves that tab sitting in the owner's browser showing the last page it looked
 * at. `release` closes it and detaches. {@link closeOwnedTab} carries the measurement and why it is
 * `tab-close` rather than `close`.
 *
 * ## The consent gate is the owner's, and it is satisfied by a secret the owner wrote
 *
 * The extension refuses an unknown client with a dialog in the owner's browser warning that a connection exposes
 * every signed-in session. `PLAYWRIGHT_MCP_EXTENSION_TOKEN` is the bypass, and the token this transport
 * uses comes from `$SLOPWEAVER_HOME/secrets/playwright-extension-token`, which the owner wrote by
 * hand — not from reading the dialog. A token lifted off the page would be this code granting
 * itself the access the dialog exists to ask about. The value is passed through the child process's
 * environment, never through argv, and never logged.
 *
 * ## Everything it writes lands in its own temp directory
 *
 * The client writes page snapshots beside its working directory, so this runs it with `cwd` set to the
 * scratch directory the transport made — never the repository root, where a `.playwright-cli/` full of real
 * console snapshots would land in the working tree and trip the hygiene gate on its way to a commit.
 *
 * ## One page per invocation, because the seam is one page
 *
 * `visit` runs one `run-code` snippet: install a response hook, navigate, settle, photograph, hand back
 * what was seen. Every STATEMENT in that snippet is fixed here; the only things that vary are three values
 * — the URL, the settle time and the screenshot path — baked in as JSON literals by
 * {@link pageVisitSnippet}. So a reviewer reads the behaviour once, in this file, and no part of the
 * snippet's control flow is assembled from anything a page said.
 *
 * **This is deliberately weaker than a constant, and the difference matters for what comes next.** An
 * earlier version of this comment claimed the snippet was a fixed constant varying only by "a JSON input
 * file". There is no input file and there cannot be one: the `run-code` context has no `require`, which
 * `pageVisitSnippet`'s own doc measures. Any future step that needs to carry a selector or typed text
 * therefore has nowhere to put it yet — a data channel has to be built before an action list can exist,
 * rather than assumed to be there. Reproduce the constraint with
 * `run-code --filename` over any snippet calling `require`.
 *
 * Measured against the live console: one page costs about 7.7 seconds end to end, of which
 * roughly 4 is client start-up, and a Host Management visit captured 21 first-party responses and a
 * 16.8 KB screenshot.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { diagnoseSnippetFailure } from "./clientKill.js";
import {
  type BrowserPageTransport,
  type BrowserTransportError,
  BrowserTransportErrors,
  type CapturedResponse,
  isWalkStoppingError,
  type PageCapture,
} from "./pageTransport.js";
import { pageVisitSnippet } from "./pageVisitSnippet.js";
import { isOnLeaseOrigin, type RelayLease } from "./relayLease.js";
import { holdRelayLease } from "./relayLeaseHold.js";
import {
  clientFailure,
  ensureAttached,
  openScratch,
  openSession,
  type PlaywrightCliDeps,
  type RelaySession,
  readSnippetOutput,
  releaseSession,
  type WalkScratch,
} from "./relaySession.js";
import { visitRecoveringSelfClosedTab } from "./selfClosedTab.js";
import { withWalkStopNoted } from "./walkStops.js";

// Re-exported so the page-visit snippet's own tests keep naming the module that RUNS it, which is where a
// reader goes looking for the behaviour. The snippet moved to `pageVisitSnippet.ts` to close
// a caller-supplied-source hole; nothing about what it does moved with it.
export { pageVisitSnippet, RESPONSE_HOOK, SCREENSHOT_TIMEOUT_MS } from "./pageVisitSnippet.js";

export type { PlaywrightCliDeps } from "./relaySession.js";

/**
 * Read the captured responses out of the snippet's output, dropping anything malformed and anything from
 * off the lease.
 *
 * The in-page hook filters by CONTENT TYPE and nothing else, so a page that loads a third party's JSON
 * hands that body back beside the platform's own. Calling those "first-party" was an intention the code did
 * not hold, and one walk is what it costs: 143 bodies from `linear.app` reduced to field names
 * and filed under Notion. The filter is here rather than in the snippet because the evaluation context has
 * no `URL` — the same measured constraint that put {@link capturedLinksOf} here.
 *
 * @param output the snippet's parsed output
 * @param lease the origins this walk is bound to
 * @returns the responses to keep, and how many were dropped for being off the lease
 * @internal exported for the Datadog console transport, whose palette arm hands back the same shape
 */
export function capturedResponsesOf({ output, lease }: { output: Record<string, unknown>; lease: RelayLease }): {
  kept: readonly CapturedResponse[];
  dropped: number;
} {
  const raw = output["responses"];
  if (!Array.isArray(raw)) {
    return { dropped: 0, kept: [] };
  }
  let dropped = 0;
  const kept = raw.flatMap((entry: unknown): readonly CapturedResponse[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const url = entry["url"];
    const method = entry["method"];
    const statusCode = entry["statusCode"];
    if (typeof url !== "string" || typeof method !== "string" || typeof statusCode !== "number") {
      return [];
    }
    if (!isOnLeaseOrigin({ lease, url })) {
      dropped += 1;
      return [];
    }
    const requestBody = entry["requestBody"];
    return [
      {
        body: entry["body"],
        method,
        statusCode,
        url,
        ...(typeof requestBody === "string" ? { requestBody } : {}),
      },
    ];
  });
  return { dropped, kept };
}

/**
 * Reduce the raw hrefs the snippet collected to the same-origin navigation a walk can use.
 *
 * Same-origin only, fragment dropped, de-duplicated and sorted — a fragment is a position on a page rather
 * than a different page, and two links differing only by one are the same destination. This runs in Node
 * rather than in the snippet because the evaluation context has no `URL`; see {@link pageVisitSnippet}.
 *
 * @param output the snippet's parsed output
 * @param finalUrl where the page settled, which is the origin links are judged against
 * @returns the same-origin links, sorted, or an empty list when the snippet collected none
 */
function capturedLinksOf({
  output,
  finalUrl,
}: {
  output: Record<string, unknown>;
  finalUrl: string;
}): readonly string[] {
  const raw = output["links"];
  if (!Array.isArray(raw)) {
    return [];
  }
  let origin: string;
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    return [];
  }
  const kept = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    try {
      const parsed = new URL(entry);
      if (parsed.origin === origin) {
        parsed.hash = "";
        kept.add(parsed.toString());
      }
    } catch {
      continue;
    }
  }
  return [...kept].toSorted();
}

/**
 * Read the accounting the snippet kept, defaulting to a shape that claims nothing.
 *
 * A body dropped for being off the lease comes off BOTH `eligible` and `bodySucceeded`, never onto
 * `bodyFailed`. A third party's response was never this walk's denominator, so counting it as wanted-and-lost
 * would report every page with an analytics call as an incomplete observation of the platform — and
 * `isCaptureComplete` reads the identity `eligible === bodySucceeded + bodyFailed`, which only stays true if
 * both move together. `seen` is left alone: it counts what the page did, which is unchanged by what this
 * walk wanted.
 *
 * @param output the snippet's parsed output
 * @param dropped how many eligible bodies were discarded for being off the lease's origins
 * @returns the accounting for the capture actually being returned
 * @internal exported beside {@link capturedResponsesOf}, for the same caller
 */
export function accountingOf({
  output,
  dropped,
}: {
  output: Record<string, unknown>;
  dropped: number;
}): PageCapture["responseAccounting"] {
  const raw = output["accounting"];
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const number = ({ key }: { key: string }): number => (typeof record[key] === "number" ? record[key] : 0);
  return {
    bodyFailed: number({ key: "bodyFailed" }),
    bodySucceeded: Math.max(0, number({ key: "bodySucceeded" }) - dropped),
    eligible: Math.max(0, number({ key: "eligible" }) - dropped),
    seen: number({ key: "seen" }),
  };
}

/**
 * Run one page-visit snippet through the terminal client and turn what it printed into a capture — through
 * `./selfClosedTab.ts`, so a page that closes its own tab costs that page rather than the walk.
 *
 * @param deps the consent token, the profile pin, the scratch directory and the clock
 * @param lease the origins this capture may carry, already checked against the address being asked for
 * @param scratch the files this transport wrote for itself
 * @param url the page to visit
 * @param settleMs how long to keep observing after load
 * @returns the capture, or the typed reason there is none
 */
function runOneVisit({
  deps,
  lease,
  scratch,
  session,
  url,
  settleMs,
  photograph,
}: {
  deps: PlaywrightCliDeps;
  lease: RelayLease;
  scratch: WalkScratch;
  session: RelaySession;
  url: string;
  settleMs: number;
  photograph: boolean;
}): Result<PageCapture, BrowserTransportError> {
  const screenshotPath = join(deps.scratchDir, `${String(Date.now())}.png`);
  const observedAt = deps.nowIso();
  try {
    return visitRecoveringSelfClosedTab({
      capture: ({ stdout }) => captureFrom({ lease, observedAt, screenshotPath, stdout, url }),
      deps,
      operation: { kind: "page-visit", photograph, screenshotPath, settleMs, url },
      scratch,
      session,
    });
  } finally {
    // The snippet writes the PNG to a FILE because that is the only way Playwright hands one back, and
    // `captureFrom` has read the bytes into `screenshotPng` by the time we get here. The file has no
    // further purpose: a picture an atlas decides to KEEP is written again by its own artifact writer,
    // content-addressed by digest. Leaving it here is pure residue, and on one atlas it was worse than
    // residue — MEASURED by a Codex review on a people-directory walk. Several walks pass their own
    // ATLAS DIRECTORY as `scratchDir`, so every page's screenshot was accumulating inside the published
    // generation, INCLUDING pages that atlas had ruled must never be photographed at all. Its two
    // policy guards run after `visit` returns and so could not have prevented this first write; only
    // removing the file here can. A `finally` rather than a line after the return, because the catch path
    // is exactly where an interrupted client leaves one behind.
    rmSync(screenshotPath, { force: true });
  }
}

/**
 * One page of a walk: hold the lease, refuse an address off it, attach, visit, and remember a stop.
 *
 * @param session the transport's own mutable state
 * @param deps the walk's dependencies
 * @param scratch the files this transport wrote for itself
 * @param url the page to visit
 * @param settleMs how long to keep observing after load
 * @returns the capture, or the typed reason there is none
 */
async function visitOnePage({
  session,
  deps,
  scratch,
  url,
  settleMs,
  photograph,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  url: string;
  settleMs: number;
  photograph: boolean;
}): Promise<Result<PageCapture, BrowserTransportError>> {
  const held = await holdRelayLease({ deps, session });
  if (held.isErr()) {
    return err(held.error);
  }
  const lease = held.value;
  if (!isOnLeaseOrigin({ lease, url })) {
    // Refused BEFORE the client runs, so an address off this walk's own origins never reaches the owner's browser
    // at all — the strongest form of "one integration's atlas cannot land in another".
    session.stopped = BrowserTransportErrors.offLeaseOrigin({
      reason: `the ${lease.platform} walk may only address ${lease.origins.join(", ")}`,
      url,
    });
    return err(session.stopped);
  }
  const ready = ensureAttached({ deps, scratch, session });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const captured = runOneVisit({ deps, lease, photograph, scratch, session, settleMs, url });
  if (captured.isErr() && isWalkStoppingError({ error: captured.error })) {
    session.stopped = captured.error;
  }
  return captured;
}

/**
 * Build the real transport.
 *
 * @param deps the client script, the owner's consent token, a scratch directory, a clock, and the home,
 *   platform and origins the machine-wide relay lease is taken with
 * @returns a transport that drives the owner's own Chrome, one page per call
 */
export function createPlaywrightCliTransport({ deps }: { deps: PlaywrightCliDeps }): BrowserPageTransport {
  const scratch = openScratch();
  const session = openSession();
  return {
    release: async (): Promise<Result<null, BrowserTransportError>> => {
      releaseSession({ deps, scratch, session });
      return ok(null);
    },
    visit: async ({ url, settleMs, photograph = true }): Promise<Result<PageCapture, BrowserTransportError>> =>
      // Omitted means yes, so every existing caller keeps photographing everything it reaches.
      withWalkStopNoted({
        result: await visitOnePage({ deps, photograph: photograph, scratch, session, settleMs, url }),
      }),
  };
}

/**
 * Refuse a page the client settled on somewhere the lease does not cover, and delete the picture of it.
 *
 * The failure exactly: the client sent this address somewhere the walk was not asked to go, and the
 * old shape returned that page's bodies anyway, filed under the platform that asked. There is no capture here
 * to hand back — a page that settled on another platform evidences nothing about this one, and the walk stops
 * rather than asking the same confused relay for another thirty addresses. The picture is of the foreign site,
 * so it is removed here rather than left in the scratch directory for the next digest-addressed writer to find.
 */
function discardOffLease({
  finalUrl,
  lease,
  screenshotPath,
}: {
  finalUrl: string;
  lease: RelayLease;
  screenshotPath: string;
}): BrowserTransportError {
  rmSync(screenshotPath, { force: true });
  return BrowserTransportErrors.offLeaseOrigin({
    reason:
      `the client sent this address somewhere the ${lease.platform} walk was not asked to go, so its ` +
      "screenshot and every response body it saw there are discarded rather than filed",
    url: finalUrl,
  });
}

/**
 * Turn what the client printed into a capture, or into the reason it is not one.
 *
 * Split out of `visit` so the assembly is one readable thing, and because the two failures it distinguishes
 * are easy to conflate: a snippet that RAN and reported a navigation problem is `NAVIGATION_FAILED`, while
 * output that could not be read at all is a RESULT-channel failure. The second is reported as
 * `SESSION_LOST` because that is the code the walk acts on, but its reason says what was actually observed —
 * a walk whose pages loaded fine and whose results never came home reads as a lost browser otherwise, and
 * that sends the reader to the wrong place entirely.
 *
 * @param stdout everything the client printed
 * @param url the page that was asked for
 * @param observedAt when the visit started
 * @param screenshotPath where the snippet was told to write its PNG
 * @param lease the relay lease whose origins bound what this capture may carry
 * @returns the capture, or why there is none
 *
 * @internal
 */
export function captureFrom({
  stdout,
  url,
  observedAt,
  screenshotPath,
  lease,
}: {
  stdout: string;
  url: string;
  observedAt: string;
  screenshotPath: string;
  lease: RelayLease;
}): Result<PageCapture, BrowserTransportError> {
  const output = readSnippetOutput({ stdout });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason:
          `the page-visit snippet for ${url} printed nothing this could read, so its RESULT never came ` +
          "back. The page may well have loaded — what failed is the channel the answer returns on",
      }),
    );
  }
  if (typeof output["failure"] === "string") {
    const failure = output["failure"];
    return err(clientFailure({ diagnosis: diagnoseSnippetFailure({ failure }), reason: failure, url }));
  }
  const finalUrl = typeof output["finalUrl"] === "string" ? output["finalUrl"] : url;
  if (!isOnLeaseOrigin({ lease, url: finalUrl })) {
    return err(discardOffLease({ finalUrl, lease, screenshotPath }));
  }
  const responses = capturedResponsesOf({ lease, output });
  const screenshot = screenshotOf({ output, screenshotPath });
  return ok({
    finalUrl,
    links: capturedLinksOf({ finalUrl, output }),
    linksBlockedBecause: typeof output["linksError"] === "string" ? output["linksError"] : null,
    observedAt,
    requestedUrl: url,
    responseAccounting: accountingOf({ dropped: responses.dropped, output }),
    responses: responses.kept,
    screenshotBlockedBecause: screenshot.blockedBecause,
    screenshotPng: screenshot.png,
    statusCode: typeof output["statusCode"] === "number" ? output["statusCode"] : null,
    title: typeof output["title"] === "string" ? output["title"] : "",
  });
}

/**
 * What the snippet's own screenshot attempt came to, as bytes or as the reason there are none.
 *
 * The two failure kinds are kept apart because they mean opposite things about the walk. The snippet
 * reporting its own error is a capture that FAILED — Chrome timed out, the tab could not be activated — and
 * that reason is carried the whole way to the gap row. A snippet that reports neither bytes nor an error was
 * asked not to photograph this page at all, and the refusal it belongs to is the atlas's own.
 *
 * @param output what the visit snippet printed
 * @param screenshotPath the file the snippet was told to write
 * @returns the PNG bytes, or `null` beside why there are none
 */
function screenshotOf({ output, screenshotPath }: { output: Record<string, unknown>; screenshotPath: string }): {
  png: Uint8Array | null;
  blockedBecause: string | null;
} {
  if (output["screenshotWritten"] === true) {
    const png = readScreenshot({ path: screenshotPath });
    if (png !== null) {
      return { blockedBecause: null, png };
    }
    return {
      blockedBecause: "the browser reported writing a screenshot and the file it named could not be read",
      png: null,
    };
  }
  const reported = output["screenshotError"];
  return { blockedBecause: typeof reported === "string" ? reported : null, png: null };
}

/** Read a screenshot the snippet wrote; a page reached but not photographed keeps its row. */
function readScreenshot({ path }: { path: string }): Uint8Array | null {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    rmSync(path, { force: true });
    return bytes;
  } catch {
    return null;
  }
}
