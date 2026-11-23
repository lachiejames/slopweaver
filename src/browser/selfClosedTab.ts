/**
 * A page that closes the tab it was opened in costs ONE page of a walk, never the walk.
 *
 * ## Why `relayRun.ts`'s reconnect cannot see this
 *
 * A page that calls `window.close()` — an OAuth completion page does — lets the terminal client exit 0 with
 * the failure inside its JSON, so `runRelayOperation` returns ok and its thrown-failure reconnect never runs.
 * `playwrightCli.ts`'s `captureFrom` then grades the snippet's `browser-closed` phrase run-stopping, and the
 * session goes sticky. MEASURED on every Hex walk: `/login-success` ended each one with
 * 24 of 56 declared routes unattempted, and `automation resync --atlas hex` failed every firing
 * (`$SLOPWEAVER_HOME/atlas/hex/pages.jsonl`, gap `session-ended-by-page`). Reproduce the recovery with
 * `slopweaver atlas hex refresh`: `/login-success` now fails alone and every later route is attempted.
 *
 * ## The same self-close THROWN, and the page straight after it
 *
 * MEASURED, the scheduled `resync-atlas-hex`: `/login-success` was lost alone as above, and
 * `/mcp-server-oauth-result` — the very next route in `atlas/hex/generated/clientSurface.ts`, another OAuth
 * completion page — closed its tab with the client exiting 1 ("the browser client exited with status 1 after
 * 1.4s … the page, its context or the browser … has been closed"). That shape reached `relayRun.ts`'s
 * `relayRecovery` with the reconnect still spent by `/login-success`'s last rebuild, so it stopped the walk.
 * Both shapes now reach ONE grader, and the bound is a count of pages lost this way since the last capture
 * rather than the reconnect bit. Reproduce with `slopweaver atlas hex refresh`: both pages fail alone.
 *
 * ## The shape: a pure decision, and a shell that takes the capture as a seam
 *
 * `selfClosedGrade.ts` is the whole judgement, total and unit-testable. {@link visitRecoveringSelfClosedTab}
 * runs it around a page visit and takes the CAPTURE as a function, so the page-visit transport keeps its own
 * parsing and this module never learns what a capture is made of.
 */
import { err, type Result } from "../lib/result.js";

import { type ClientDiagnosis, diagnoseSnippetFailure } from "./clientKill.js";
import { type BrowserTransportError, BrowserTransportErrors, type PageCapture } from "./pageTransport.js";
import type { RelayOperation } from "./relayOperation.js";
import { rebuildRelay, runRelayOperationDiagnosed } from "./relayRun.js";
import { type PlaywrightCliDeps, type RelaySession, readSnippetOutput, type WalkScratch } from "./relaySession.js";
import {
  gradedFailures,
  restoresReconnectAfterLostPage,
  type SelfClosedTabRecovery,
  selfClosedTabRecovery,
} from "./selfClosedGrade.js";

/**
 * The `because` a page that closed its own tab carries, in words a record may hold.
 *
 * @internal exported for the guard that asserts a self-closed page is graded with it
 */
export const PAGE_CLOSED_ITS_OWN_TAB_BECAUSE =
  "the page closed the browser tab it was opened in, and did so again on a freshly attached tab — an OAuth " +
  "completion page does this by design — so this page costs itself alone and the walk carries on in a new tab";

/**
 * The failure a page-visit snippet reported about its own page, or `null` when it reported none.
 *
 * @param stdout everything the client printed
 * @returns the snippet's own failure string, or `null` when the snippet reported none or printed nothing
 *   readable
 * @internal exported for its unit test
 */
export function snippetFailureOf({ stdout }: { stdout: string }): string | null {
  const output = readSnippetOutput({ stdout });
  if (output === null) {
    return null;
  }
  const failure = output["failure"];
  return typeof failure === "string" ? failure : null;
}

/** One attempt at a page: the capture, beside every page-relevant failure the attempt met on the way. */
interface VisitAttempt {
  readonly captured: Result<PageCapture, BrowserTransportError>;
  readonly diagnoses: readonly ClientDiagnosis[];
}

/** Everything one page visit's attempts and rebuilds share. */
interface PageVisit {
  readonly deps: PlaywrightCliDeps;
  readonly scratch: WalkScratch;
  readonly session: RelaySession;
  readonly operation: Extract<RelayOperation, { kind: "page-visit" }>;
  readonly capture: (input: { stdout: string }) => Result<PageCapture, BrowserTransportError>;
}

/** Run the page once through the relay, and say which of the failures it met are graded. */
function attemptPage({ visit }: { visit: PageVisit }): VisitAttempt {
  const run = runRelayOperationDiagnosed(visit);
  if (run.result.isErr()) {
    // A failed re-attach carries no terminal client failure, so it is never graded as another self-close.
    return {
      captured: err(run.result.error),
      diagnoses: gradedFailures({ last: run.terminalFailure, priorFailures: run.priorFailures }),
    };
  }
  const failure = snippetFailureOf({ stdout: run.result.value });
  return {
    captured: visit.capture({ stdout: run.result.value }),
    diagnoses: gradedFailures({
      last: failure === null ? null : diagnoseSnippetFailure({ failure }),
      priorFailures: run.priorFailures,
    }),
  };
}

/**
 * The page closed a fresh tab too, so it is the page. Rebuild once more so the next page has a tab, and grade
 * this one alone — a rebuild that cannot reach a browser stops the walk instead.
 */
function loseOnePage({ visit }: { visit: PageVisit }): Result<PageCapture, BrowserTransportError> {
  const { deps, scratch, session } = visit;
  const again = rebuildRelay({ deps, reason: PAGE_CLOSED_ITS_OWN_TAB_BECAUSE, scratch, session });
  if (again.isErr()) {
    return err(again.error);
  }
  session.selfClosedPagesSinceCapture += 1;
  if (restoresReconnectAfterLostPage({ selfClosedPagesSinceCapture: session.selfClosedPagesSinceCapture })) {
    session.reconnectSpent = false;
  }
  return err(
    BrowserTransportErrors.navigationFailed({
      because: PAGE_CLOSED_ITS_OWN_TAB_BECAUSE,
      reason: "the page closed its own tab on two attempts",
      url: visit.operation.url,
    }),
  );
}

/**
 * Visit one page, rebuilding the relay when the page closes the tab it was opened in.
 *
 * A drop of the relay itself recovers the page on the retry; a page that closes the fresh tab too costs
 * itself and leaves a freshly attached tab for the next one. That last attach succeeding restores the
 * ordinary reconnect budget below the bound only (`restoresReconnectAfterLostPage`), because
 * `selfClosedPagesSinceCapture` is the independent bound — a capture resets it, and a self-closed page past
 * it stops the run without another rebuild.
 *
 * @param deps the consent token, the profile pin and the scratch directory the client and the rebuild need
 * @param scratch the files the transport wrote for itself
 * @param session the transport's own mutable state
 * @param operation the declared page-visit operation
 * @param capture how the transport turns what the client printed into a capture
 * @returns the capture, or the typed reason there is none
 */
export function visitRecoveringSelfClosedTab({
  deps,
  scratch,
  session,
  operation,
  capture,
}: {
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  session: RelaySession;
  operation: Extract<RelayOperation, { kind: "page-visit" }>;
  capture: (input: { stdout: string }) => Result<PageCapture, BrowserTransportError>;
}): Result<PageCapture, BrowserTransportError> {
  const visit: PageVisit = { capture, deps, operation, scratch, session };
  const grade = ({ diagnoses }: { diagnoses: readonly ClientDiagnosis[] }): SelfClosedTabRecovery =>
    selfClosedTabRecovery({ diagnoses, selfClosedPagesSinceCapture: session.selfClosedPagesSinceCapture });
  const captured = (attempt: VisitAttempt): boolean => {
    if (attempt.captured.isOk()) {
      session.selfClosedPagesSinceCapture = 0;
    }
    return attempt.captured.isOk();
  };
  const first = attemptPage({ visit });
  if (captured(first)) {
    return first.captured;
  }
  const firstGrade = grade({ diagnoses: first.diagnoses });
  if (firstGrade === "rebuild-and-lose-one-page") {
    return loseOnePage({ visit });
  }
  if (firstGrade !== "rebuild-and-retry") {
    return first.captured;
  }
  const rebuilt = rebuildRelay({ deps, reason: first.diagnoses[0]!.because, scratch, session });
  if (rebuilt.isErr()) {
    return err(rebuilt.error);
  }
  const second = attemptPage({ visit });
  if (captured(second)) {
    return second.captured;
  }
  if (grade({ diagnoses: [...first.diagnoses, ...second.diagnoses] }) === "rebuild-and-lose-one-page") {
    return loseOnePage({ visit });
  }
  return second.captured;
}
