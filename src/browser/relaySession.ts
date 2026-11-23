/**
 * The relay session every browser leg on this machine runs through — lease, attach, one snippet, clean up —
 * over the CLOSED set of operations a snippet may be, declared in `relayOperation.ts` and turned into source
 * in exactly one place, `relayDispatch.ts`.
 *
 * ## Why this module exists, and what it is deliberately not
 *
 * This plumbing once lived inside `playwrightCli.ts` beside the one operation it served, and
 * the only snippet that could reach the owner's Chrome was a page visit: navigate, settle, photograph. That
 * was the whole of the safety argument every atlas walk rests on, and `pageTransport.ts` states it as a
 * property of its own seam — *"it performs no click, no form submission and no request replay"*.
 *
 * A second operation was then needed. Vanta's Manage API has no policy-version upload
 * operation at all, so the browser is the ONLY place a policy version can ever be published from, and the
 * owner's ruling is that the fleet must therefore be able to write there.
 *
 * So the plumbing moved here and the thing that varies became a {@link RelayOperation} — a closed union
 * this module dispatches on, whose snippet source is chosen INSIDE it. That shape is the whole point:
 *
 * - **No caller supplies snippet source.** {@link runRelayOperation} takes an operation, never code, so
 *   there is no public raw-execution route into the owner's browser and no selector, no keystroke and no page
 *   script can arrive from a caller that has not declared one here. That sentence was FALSE for one
 *   iteration of this module — the page-visit builder was injected as a callback and a Codex review pass
 *   found that a caller could return any source at all from it. `pageVisitSnippet.ts` carries the account,
 *   and the fix is that no parameter on this path carries a value that becomes code.
 * - **`BrowserPageTransport` did not change.** Its no-click invariant is exactly as true as it was, and no
 *   atlas walk gained a capability. The new arms are reachable only through the Vanta editor transport,
 *   which is a different interface with a different door in front of it.
 * - **Every operation is still one page, one lease, one client invocation.** The exclusion and the
 *   origin-binding in `relayLease.ts` are unmoved and now cover the write arms too — a Vanta edit cannot be
 *   asked for a `github.com` address any more than a Notion walk can.
 *
 * ## What a write arm costs, stated rather than discovered
 *
 * `admit/coverage.ts` sanctioned `playwrightCli.ts` as a read-only tool BECAUSE its snippet could not
 * click. That is no longer true of this module, and the accounting says so rather than inheriting a
 * classification that has stopped being honest. The governed write arms are door-internal: the only caller
 * is a verb that has been through `throughDoor` with an approval digest over the exact substitution.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { logger } from "../lib/logger.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  actOnCloseRestore,
  agentWindowAfterAttach,
  giveBackForeground,
  readChromeWindowIds,
  restoreAfterClose,
  sayIfRefused,
  UNNAMED_AGENT_WINDOW_LINE,
} from "./backgroundPlacement.js";
import { type ClientDiagnosis } from "./clientKill.js";
import { FATHOM_CUES_WAIT_MS } from "./fathomShareSnippet.js";
import {
  type ForegroundRun,
  placementFromEnv,
  readForeground,
  realForegroundRun,
  type WindowPlacement,
} from "./foreground.js";
import { type BrowserTransportError, BrowserTransportErrors } from "./pageTransport.js";
import { NAVIGATION_TIMEOUT_MS, SCREENSHOT_TIMEOUT_MS } from "./pageVisitSnippet.js";
import type { RelayLease, RelayLeaseWait } from "./relayLease.js";
import type { RelayOperation } from "./relayOperation.js";
import { type GuardedProcess, guardOwnedTab, nodeProcessGuard } from "./tabGuard.js";

/* Where the walk lane says a restore or raise macOS refused: stderr, so a walk's stdout stays its own answer. */
const sayOnStderr: (line: string) => void = (line) => {
  logger.error({ msg: line });
};

/**
 * The Chrome channel the extension relay resolves a default profile for.
 *
 * @internal
 */
export const CHROME_CHANNEL = "chrome";

/**
 * How long a client invocation that is NOT one declared operation may take before it is killed — the attach,
 * and the `tab-close`/`detach` pair on the way out.
 *
 * Generous, and it stays generous: the attach is the one call that legitimately launches Chrome through the
 * profile pin, so it pays a browser start rather than a page. An operation does not use this — it derives its
 * own bound from the work it declared, in {@link clientBoundMs}.
 *
 * Measured: a page costs about 7.7 seconds end to end of which roughly 4 is the client coming up.
 *
 * @internal
 */
export const VISIT_TIMEOUT_MS = 120_000;

/**
 * What one client invocation costs BEYOND the in-page work it was asked for: the client process coming up,
 * and the steps in a snippet this module does not bound itself (`page.bringToFront()`, `$$eval`,
 * `page.title()`).
 *
 * Measured twice: client start-up is roughly 4 s of a 5.7-7.7 s page, at load
 * average 17-22 with 44 users. This is about 3.75× that, so it is headroom rather than a ceiling anything has
 * been near. Reproduce the whole-page cost with:
 *
 * ```bash
 * { slopweaver atlas vanta walk 2>&1; } | perl -MTime::HiRes=time -ne 'BEGIN{$s=time;$|=1} printf("%8.2f %s", time-$s, $_)'
 * ```
 *
 * @internal
 */
export const CLIENT_OVERHEAD_BUDGET_MS = 15_000;

/**
 * The bound one DECLARED operation's client invocation gets — derived from the work that operation asked for,
 * never one flat number.
 *
 * ## Why it is derived, which is the part a flat constant cannot do
 *
 * MEASURED over two twelve-page Vanta walks: every lost page
 * cost exactly the old flat 120 s bound and every page that worked cost 5.7-6.9 s, with nothing in between.
 * 120 s is nearly three times the work a page visit can legitimately contain, so a hang held the owner's
 * Chrome for two minutes to learn nothing. But it cannot simply be lowered: `SHOT_MAX_SETTLE_MS` is 60 s
 * (`cli/commands/browser/shotFlags.ts`), so `browser shot --raw --settle 60000` legitimately needs
 * 60 + 45 + screenshots + start-up — already inside a whisker of 120, and any flat shorten breaks that verb.
 *
 * Deriving fixes both ends at once. A Vanta, Datadog or Linear page (4 s settle) is bounded at 80 s instead of
 * 120; a 60-second-settle shot gets 136 s instead of being one settle bump from a bound it could not see.
 *
 * ## What it composes, and the one number that is a judgement
 *
 * `NAVIGATION_TIMEOUT_MS` and `SCREENSHOT_TIMEOUT_MS` are the snippet's own bounds, and the screenshot is
 * attempted TWICE — the count is fixed in `pageVisitSnippet.ts`'s `screenshotBlock`, and a change there
 * changes this. The arm's own declared wait is `settleMs`, or `readinessTimeoutMs` for the two arms that wait
 * for a target to render. {@link CLIENT_OVERHEAD_BUDGET_MS} is the only judgement, and it carries its
 * measurement.
 *
 * @param operation the declared operation, which is what says how long its own in-page work may take
 * @returns the bound in milliseconds
 */
export function clientBoundMs({ operation }: { operation: RelayOperation }): number {
  return NAVIGATION_TIMEOUT_MS + inPageWaitMs({ operation }) + 2 * SCREENSHOT_TIMEOUT_MS + CLIENT_OVERHEAD_BUDGET_MS;
}

/**
 * The wait one operation declared for itself.
 *
 * Every arm carries one, which is why the derivation above is possible at all — and the compiler holds that:
 * `operation.settleMs` only resolves because every arm but the two readiness waits declares it, so an arm added
 * without a declared wait fails to compile here rather than silently inheriting somebody else's bound.
 *
 * @param operation the declared operation
 * @returns the declared in-page wait in milliseconds
 */
function inPageWaitMs({ operation }: { operation: RelayOperation }): number {
  if (operation.kind === "page-evidence-capture" || operation.kind === "datadog-monitor-backtest") {
    return operation.readinessTimeoutMs;
  }
  if (operation.kind === "fathom-share-transcript") {
    // The settle, then the bounded poll for the page's own boot to deliver the cues.
    return operation.settleMs + FATHOM_CUES_WAIT_MS;
  }
  return operation.settleMs;
}

/**
 * The most the client may print before `execFileSync` refuses to buffer it.
 *
 * @internal
 */
export const MAX_CLIENT_OUTPUT_BYTES = 16 * 1_048_576;

/**
 * How many times the client's own double encoding is unwrapped before the read gives up.
 *
 * A bounded loop rather than a fixed number of `JSON.parse` calls: measured, two parses were one
 * short and the failure read exactly like a lost browser session.
 */
const MAX_RESULT_UNWRAPS = 4;

/** What the transport needs to reach the CLI and the owner's browser. */
export interface PlaywrightCliDeps {
  /** The extension consent token the OWNER provisioned. Never read from a page. */
  readonly extensionToken: string;
  /**
   * The profile pin from `resolveChromePin`, so the connect page opens in the recorded WORK profile.
   *
   * Required rather than optional on purpose: without it the relay launches Chrome bare, and Chrome puts
   * the page in whichever profile the owner last used — their personal one, if that is what they were reading.
   * `src/browser/profilePin.ts` carries the measurement.
   */
  readonly chromePinPath: string;
  /** Where PNG artifacts are written, so the transport hands back bytes the walk can address. */
  readonly scratchDir: string;
  readonly nowIso: () => string;
  /**
   * The state home the machine-wide relay lease's lock file lives under.
   *
   * Required for the same reason {@link PlaywrightCliDeps.chromePinPath} is: there is no shape of this
   * transport that can forget to take the lease, because there is no shape of it that can be constructed
   * without somewhere to take it.
   */
  readonly home: string;
  /** The atlas or lane whose run this is, so a refusal on the other side of the lease can name the holder. */
  readonly platform: string;
  /**
   * Every origin this run may address — its whole world for the length of the lease.
   *
   * A transport bound to `https://app.notion.com` cannot be asked for a `linear.app` address, cannot return
   * a capture that settled on one, and cannot carry a response body from one. `browser/relayLease.ts`
   * carries the measurement that made this a binding rather than an intention.
   */
  readonly origins: readonly string[];
  /**
   * How this run waits for a live holder of the relay lease — `realRelayLeaseWait()` in production.
   *
   * Required for the reason {@link PlaywrightCliDeps.home} is: a transport built without it would have to
   * pick a wait of its own, and a refusal the instant the tab is busy is the failure `relayLease.ts` measures.
   */
  readonly leaseWait: RelayLeaseWait;
  /**
   * The process the owned-tab guard registers against, so a run that never reaches `release` still closes
   * its tab. Defaults to the running process; a test supplies a recorder and touches no real handler.
   */
  readonly guarded?: GuardedProcess;
  /**
   * The seam the foreground restore probes and acts through — `src/browser/foreground.ts`. Defaults to the
   * real `lsappinfo`/`osascript`/`open`; a test supplies a recorder and moves no real window.
   */
  readonly foreground?: ForegroundRun;
  /**
   * Where the walk's window goes once attached. Absent means the run's own choice, read off its environment
   * ({@link walkPlacement}); a test names it outright.
   */
  readonly placement?: WindowPlacement;
}

/**
 * Where this walk's window belongs: the placement its deps name, else the run's own environment. Pure.
 *
 * @param deps the transport's dependencies, of which only the placement is read
 * @param env the run's environment, `process.env` in production
 * @returns `background` unless this run chose to show its window
 */
export function walkPlacement({
  deps,
  env,
}: {
  deps: Pick<PlaywrightCliDeps, "placement">;
  env: Readonly<Record<string, string | undefined>>;
}): WindowPlacement {
  if (deps.placement !== undefined) {
    return deps.placement;
  }
  return placementFromEnv({ env });
}

/**
 * The seam the foreground restore runs through. Production builds its deps without one, because the real
 * `lsappinfo`/`osascript`/`open` are what a walk moves the owner's windows with; only a test hands in a recorder.
 */
function foregroundRunOf({ foreground }: { foreground: ForegroundRun | undefined }): ForegroundRun {
  if (foreground === undefined) {
    return realForegroundRun;
  }
  return foreground;
}

/** The files one transport wrote for itself, all inside its own temp directory. */
export interface WalkScratch {
  readonly clientScript: string;
  readonly snippetPath: string;
  readonly workDir: string;
}

/**
 * Everything one transport carries between calls. Mutable by construction — a run is a sequence of
 * operations against one attached relay — and held here rather than in closures so a factory stays a thin
 * shell.
 */
export interface RelaySession {
  /** The machine's one relay lease, taken on the first operation and held until release. */
  lease: RelayLease | null;
  attached: boolean;
  /**
   * Chrome's own id for the window the attach opened, read the moment the attach returned and the
   * extension had focused it. `null` until then, or when the front app was not Chrome at that instant —
   * and a restore with no id to compare against leaves the foreground alone (`foreground.ts`).
   */
  agentWindowId: number | null;
  /**
   * Disposes the owned-tab guard. Set the moment a tab exists, so every ending the process is told about
   * still closes it — `tabGuard.ts` carries the measurement of the twelve unguarded release sites.
   */
  disposeGuard: (() => void) | null;
  /**
   * The run-stopping failure every later operation is refused with, once one has happened.
   *
   * A failure only reaches this field once {@link runRelayOperation} has already declined to rebuild the
   * relay for it — either because a fresh attach could not clear it (a version-skewed client), because the
   * rebuilt relay dropped the same page again, or because the attach itself failed. So this stays the end
   * of a run; what changed is that a single dropped relay is no longer one, and neither is a page that closes
   * its own tab (`selfClosedGrade.ts`'s `selfClosedTabRecovery`). A relay lease
   * `relayLeaseHold.ts` waited for and never got lands here too, so the wait is paid once per run.
   */
  stopped: BrowserTransportError | null;
  /**
   * Whether this run's one reconnect is currently spent, so the next drop ends it.
   *
   * The budget, and deliberately not a count. A constant here would be a threshold nobody measured — the
   * finding that put this in (two Linear attempts stopping at 137 and 147 of 251 declared
   * pages) could not even separate whether the ceiling was page count, elapsed time or memory, so there is
   * no number to derive one from. The rule needs none: **a reconnect is spent when it is taken and restored
   * by the next successful client invocation**, so progress is what buys the next one and no two reconnects
   * can ever run back to back.
   *
   * What that bounds, case by case. A relay that drops once costs one attach and the walk finishes. A
   * rebuilt relay that drops the same page again is spent, and the run stops. A browser that is genuinely
   * gone fails the attach itself with `TRANSPORT_UNAVAILABLE`, which carries no phrase and so is not in the
   * reconnect set at all — one wasted attach, then the run stops. And a relay dropping every other page
   * walks to the end paying an attach each time, which is slow and is a walk that COMPLETED; the progress
   * instrumentation is what makes that visible rather than silent.
   *
   * One deliberate restore that is not a client success: a page lost for closing a freshly attached tab
   * (`selfClosedTab.ts`) clears this once its rebuild attaches, because the NEXT page never had a go at the
   * new tab — but only below the bound, so the page after the last allowed loss gets no rebuild.
   * {@link RelaySession.selfClosedPagesSinceCapture} is what bounds that path instead.
   */
  reconnectSpent: boolean;
  /**
   * Pages this run has lost to closing their own tab since its last captured page.
   *
   * The bound on the one path that restores {@link RelaySession.reconnectSpent} without progress, so a
   * browser that kills every tab stops the walk at `selfClosedGrade.ts`'s
   * `MAX_SELF_CLOSED_PAGES_WITHOUT_CAPTURE` rather than paying an attach per page. A capture resets it.
   */
  selfClosedPagesSinceCapture: number;
}

/**
 * Mint the scratch a transport works in, with its client shim already written.
 *
 * @returns the transport's own files
 */
export function openScratch(): WalkScratch {
  const workDir = mkdtempSync(join(tmpdir(), "slopweaver-page-walk-"));
  const scratch: WalkScratch = {
    clientScript: join(workDir, "client.cjs"),
    snippetPath: join(workDir, "visit.cjs"),
    workDir,
  };
  writeFileSync(scratch.clientScript, clientShim(), { mode: 0o600 });
  return scratch;
}

/**
 * A fresh, unattached session.
 *
 * @returns the session a transport factory holds
 */
export function openSession(): RelaySession {
  return {
    agentWindowId: null,
    attached: false,
    disposeGuard: null,
    lease: null,
    reconnectSpent: false,
    selfClosedPagesSinceCapture: 0,
    stopped: null,
  };
}

/**
 * Run the terminal client once, SYNCHRONOUSLY.
 *
 * `execFileSync` rather than an async spawn because `no-headless` in `yarn lint` bans every asynchronous
 * child-process capability outright — AGENTS.md rule 2, no model may be started where the owner cannot see
 * it. Nothing is lost: a run is strictly sequential, one page at a time, so there was no concurrency to
 * give up.
 *
 * @param args the client's argv tail
 * @param chromePinPath the shim Chrome is launched through, so the connect page opens in the work profile
 * @param token the owner's own extension consent secret, passed through the environment and never argv
 * @param timeoutMs how long this particular invocation may take before it is killed
 * @returns everything the client printed
 */
export function runClient({
  args,
  cwd,
  token,
  chromePinPath,
  timeoutMs,
}: {
  args: readonly string[];
  cwd: string;
  token: string;
  chromePinPath: string;
  timeoutMs: number;
}): string {
  return execFileSync(process.execPath, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PLAYWRIGHT_MCP_EXECUTABLE_PATH: chromePinPath,
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: token,
    },
    maxBuffer: MAX_CLIENT_OUTPUT_BYTES,
    timeout: timeoutMs,
  });
}

/**
 * Build the terminal client shim this transport writes into its own scratch directory.
 *
 * `playwright-core` publishes `./lib/tools/cli-client/program` in its `exports` map, so this is a supported
 * entry point rather than a reach into internals — verified against playwright-core 1.61.1 with
 * `node -e 'console.log(Object.keys(require("playwright-core/package.json").exports))'`. The shim exists
 * only because the client wants an argv, and building one through a shell would put a console URL on a
 * command line. The module path is RESOLVED here rather than written as a bare specifier, because the shim
 * runs from a temp directory and CommonJS resolution walks up from the file, not from the working
 * directory — a bare specifier there fails with `MODULE_NOT_FOUND`.
 *
 * @returns the shim source
 */
function clientShim(): string {
  const resolved = createRequire(import.meta.url).resolve("playwright-core/lib/tools/cli-client/program");
  return `const { program } = require(${JSON.stringify(resolved)});
program(["node", "playwright-cli", ...process.argv.slice(2)]);
`;
}

/**
 * Parse what a snippet returned, without trusting any of it.
 *
 * The payload arrives DOUBLE-encoded and that is the client's doing, not ours: it prints
 * `{"result": "<value>"}` where `<value>` is itself the JSON-encoded form of the string our snippet
 * returned.
 *
 * @param stdout everything the client printed
 * @returns the snippet's own object, or `null` when nothing usable came back
 */
export function readSnippetOutput({ stdout }: { stdout: string }): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  let unwrapped: unknown = value["result"];
  for (let step = 0; step < MAX_RESULT_UNWRAPS && typeof unwrapped === "string"; step += 1) {
    try {
      unwrapped = JSON.parse(unwrapped);
    } catch {
      return null;
    }
  }
  return isRecord(unwrapped) ? unwrapped : null;
}

/**
 * Attach on the first operation, and register the tab guard the moment a tab exists.
 *
 * @param session the transport's own mutable state
 * @param deps the consent token and the profile pin
 * @param scratch the files this transport wrote for itself
 * @returns nothing once attached, or why the owner's browser could not be reached
 */
export function ensureAttached({
  session,
  deps,
  scratch,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
}): Result<null, BrowserTransportError> {
  if (session.attached) {
    return ok(null);
  }
  const run = foregroundRunOf({ foreground: deps.foreground });
  // What the owner was looking at, read BEFORE Chrome and the extension bring the walk's window in front of it.
  const before = readForeground({ run });
  const beforeIds = readChromeWindowIds({ run });
  const background = walkPlacement({ deps, env: process.env }) === "background";
  const attachment = attachToOwnerChrome({ deps });
  if (attachment.isErr()) {
    // A failed attach may still have brought Chrome and the connect page in front of the owner, so whatever changed is put
    // back exactly as the terminal-client lane's `finally` does.
    if (background) {
      sayIfRefused({ outcome: actOnCloseRestore({ before, now: readForeground({ run }), run }), report: sayOnStderr });
    }
    return err(attachment.error);
  }
  session.attached = true;
  // The attach returns once the extension has connected — and focused — the walk's window, so Chrome's
  // front window at this instant IS the walk's own, whether or not Chrome is the front app. That id is what every
  // later restore compares against.
  const after = readForeground({ run });
  const naming = agentWindowAfterAttach({ beforeIds, now: after, run });
  session.agentWindowId = naming.windowId;
  // A run that chose to show its window leaves it where the extension put it: in front of the owner.
  if (background) {
    giveBackForeground({ agentWindowId: session.agentWindowId, before, report: sayOnStderr, run });
    // With no agent window named, no restore this walk makes can find its window, so put back whatever changed across
    // the attach — the terminal-client lane's fallback. A Chrome that would not name or list its windows
    // is Automation withdrawn, and is said, once.
    if (naming.windowId === null) {
      sayIfRefused({ outcome: actOnCloseRestore({ before, now: after, run }), report: sayOnStderr });
    }
    if (naming.unnamed) {
      logger.error({ msg: UNNAMED_AGENT_WINDOW_LINE });
    }
  }
  session.disposeGuard = guardOwnedTab({
    close: () => {
      closeOwnedTab({ clientScript: scratch.clientScript, deps, workDir: scratch.workDir });
    },
    guarded: deps.guarded ?? nodeProcessGuard(),
  });
  return ok(null);
}

/**
 * Grade a failed client invocation: a walk whose remaining pages are already lost stops the run, anything
 * else costs one page.
 *
 * The grade is the diagnosis's own `runStopping`, so the phrase list lives in exactly one place
 * (`browser/clientKill.ts`'s `CLIENT_PHRASES`) rather than in a second matcher here. It used to be a local
 * list re-lowercasing the thrown message, and it stayed a matcher rather than an exit code for a measured
 * reason worth keeping: three of four concurrent walks died on an uncaught `Error: Session
 * closed` thrown out of `playwright-core`'s `lib/tools/cli-client/session.js`, which reaches this process
 * only as a child that exited non-zero with the trace on its stderr.
 *
 * **The run-stopping arm carries the DIAGNOSIS, not the thrown text, and that half is load-bearing.**
 * `BrowserTransportError` gives `because` to `NAVIGATION_FAILED` alone, so a run-stopping failure has one
 * field to say anything in — and what the throw itself says is `Command failed: node …/client.cjs run-code
 * --filename …`, which names a temp path and no mechanism at all. That string is what `./walkStops.ts`
 * notes and `live/resync/outcome.ts` then records as the reason a resync failed, so an operator reading a
 * failed pass would learn nothing: not that the relay dropped, not that the client is version-skewed, and
 * not that one `playwright-cli -s=chrome open` clears it. `diagnosis.because` is composed entirely of
 * `clientKill.ts`'s own literals, and the raw text is not lost to anyone watching — `execFileSync` forwards
 * the child's stderr to this process's stderr (that module's header). Giving `SESSION_LOST` a `because` of
 * its own is the wider fix and a named follow-up: eight producers and twenty-six test call sites, none of
 * them about this.
 *
 * @param reason what the client failure said — carries the URL, so it reaches the per-page arm's `message`
 *   and nothing else
 * @param diagnosis what the failure WAS, in words a record may carry
 * @param url the address the operation was for
 * @returns the typed transport failure
 */
export function clientFailure({
  reason,
  url,
  diagnosis,
}: {
  reason: string;
  url: string;
  diagnosis: ClientDiagnosis;
}): BrowserTransportError {
  if (diagnosis.runStopping) {
    return BrowserTransportErrors.sessionLost({ reason: diagnosis.because });
  }
  return BrowserTransportErrors.navigationFailed({ because: diagnosis.because, reason, url });
}

/**
 * Let go of the tab, the relay, the scratch and — last — the lease.
 *
 * The browser is the owner's and stays open. The order matters: the next run may start the instant the lease is
 * gone, so the tab must already be closed by then.
 *
 * The CLOSE takes the foreground too, and that half was measured rather than reasoned about: `tab-close`
 * and `detach` each run the terminal client through the profile pin, which hands Chrome a URL and makes it
 * activate all over again — sampling one `browser shot` caught a second steal ~5 seconds
 * AFTER the capture had already been written. So the release restores the foreground exactly as an
 * operation does, and this one is the last thing a walk does, so it is the state the owner is left looking at.
 *
 * @param session the transport's own mutable state
 * @param deps the consent token and the profile pin the close needs
 * @param scratch the files this transport wrote for itself
 */
export function releaseSession({
  session,
  deps,
  scratch,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
}): void {
  if (session.attached) {
    session.attached = false;
    const run = foregroundRunOf({ foreground: deps.foreground });
    const before = readForeground({ run });
    closeOwnedTab({ clientScript: scratch.clientScript, deps, workDir: scratch.workDir });
    sayIfRefused({ outcome: restoreAfterClose({ before, run }), report: sayOnStderr });
  }
  session.disposeGuard?.();
  session.disposeGuard = null;
  rmSync(scratch.workDir, { force: true, recursive: true });
  session.lease?.release();
  session.lease = null;
}

/**
 * Close the tab this run opened, then detach. Best-effort, because a browser that has already gone away
 * is the ordinary ending of a long run and is not a failure worth reporting over the run's own outcome.
 *
 * `tab-close` rather than `close`: the relay's `close` shuts the whole browser context, which on an
 * attached real Chrome is the owner's window.
 */
function closeOwnedTab({
  clientScript,
  workDir,
  deps,
}: {
  clientScript: string;
  workDir: string;
  deps: PlaywrightCliDeps;
}): void {
  for (const args of [["tab-close"], ["detach"]]) {
    try {
      runClient({
        args: [clientScript, `-s=${CHROME_CHANNEL}`, ...args, "--json"],
        chromePinPath: deps.chromePinPath,
        cwd: workDir,
        timeoutMs: VISIT_TIMEOUT_MS,
        token: deps.extensionToken,
      });
    } catch {
      // Best-effort by design — see this function's own doc comment.
    }
  }
}

/**
 * Establish the extension relay.
 *
 * NOT exported, and that is the structural half of the relay lease: reaching the daemon is what the lease
 * guards, so the only caller is {@link ensureAttached}, which runs after it has been taken. An eager
 * pre-flight attach from a verb opens a connect tab and can take the daemon off a run that legitimately
 * holds the lease, since the relay serves one client at a time.
 *
 * @param deps the same dependencies the transport takes
 * @returns nothing on success, or why the owner's browser could not be reached
 */
function attachToOwnerChrome({ deps }: { deps: PlaywrightCliDeps }): Result<null, BrowserTransportError> {
  const workDir = mkdtempSync(join(tmpdir(), "slopweaver-relay-attach-"));
  const clientScript = join(workDir, "client.cjs");
  writeFileSync(clientScript, clientShim(), { mode: 0o600 });
  try {
    runClient({
      args: [clientScript, "attach", `--extension=${CHROME_CHANNEL}`, "--json"],
      chromePinPath: deps.chromePinPath,
      cwd: workDir,
      timeoutMs: VISIT_TIMEOUT_MS,
      token: deps.extensionToken,
    });
    return ok(null);
  } catch (error: unknown) {
    return err(
      BrowserTransportErrors.unavailable({
        reason:
          `could not attach to the owner's Chrome through the Playwright Extension: ${errorMessage({ error })}. ` +
          "Check that Chrome is running and that the extension is installed in its default profile",
      }),
    );
  } finally {
    rmSync(workDir, { force: true, recursive: true });
  }
}
