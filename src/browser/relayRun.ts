/**
 * Running ONE operation through a relay session — the attempt, the reconnect, and the leased ordering above
 * both.
 *
 * `./relaySession.ts` owns a session's own state and lifecycle: opening it, taking the lease, attaching to
 * the owner's Chrome, invoking the client, closing the tab it owns, releasing. This module is the layer
 * directly above that, and the split is one-directional on purpose — everything here imports from there and
 * nothing there imports from here.
 *
 * ## Why a dropped relay is retried at all
 *
 * MEASURED on one seat, two independent attempts at the 251-page Linear settings walk: one
 * stopped at `137/251`, the other at `147/251` carrying `Error: Session closed` out of
 * `playwright-core/lib/tools/cli-client/session.js:252`, and the Xero walk in the same sweep died on the
 * sibling `Target page, context or browser has been closed`. Raising the cap was attempt 2 and it is what
 * produced that evidence, so the answer is not a longer clock.
 *
 * Every page of every walk is already its own child process, and the relay LEASE survives an attach. So a
 * dropped session loses exactly one thing — the attach — and `ensureAttached` knows how to rebuild it. The
 * 147 pages already captured are in the walk's own array and were never at risk.
 *
 * ## The two things that keep the retry from being a loop or a lie
 *
 * **The budget invents no constant: progress buys the next reconnect.** `RelaySession.reconnectSpent` is set
 * when one is taken and cleared by the next SUCCESSFUL invocation, so two reconnects can never run back to
 * back, and a browser that is simply gone fails the re-attach with `TRANSPORT_UNAVAILABLE` — which carries
 * no phrase and is therefore not in the reattachable set at all.
 *
 * **It sits BELOW `withWalkStopNoted`**, which is what leaves the resync verb's judgement intact. A
 * RECOVERED drop never reaches `./walkStops.ts`'s stop register, so `live/resync/outcome.ts` grades a walk
 * that finished on its clock like any other; an unrecovered one returns the same `SESSION_LOST` and still
 * fails the attempt. The recovery is reported on its own register instead (`noteRelayRecovery`) and printed
 * without ever touching `problems`.
 */
import { writeFileSync } from "node:fs";

import { errorMessage } from "../lib/errorMessage.js";
import { logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";

import { giveBackForeground } from "./backgroundPlacement.js";
import { type ClientDiagnosis, diagnoseClientFailure, readClientFailureFacts } from "./clientKill.js";
import { readForeground, realForegroundRun } from "./foreground.js";
import { type BrowserTransportError, BrowserTransportErrors } from "./pageTransport.js";
import { relayOperationSnippet } from "./relayDispatch.js";
import { isOnLeaseOrigin, type RelayLease } from "./relayLease.js";
import { holdRelayLease, leaseFor } from "./relayLeaseHold.js";
import type { RelayOperation } from "./relayOperation.js";
import {
  CHROME_CHANNEL,
  clientBoundMs,
  clientFailure,
  ensureAttached,
  type PlaywrightCliDeps,
  type RelaySession,
  runClient,
  type WalkScratch,
  walkPlacement,
} from "./relaySession.js";
import { noteRelayRecovery, withWalkStopNoted } from "./walkStops.js";

/**
 * What to do about one failed client invocation.
 *
 * @internal — the return of {@link relayRecovery}.
 */
export type RelayRecovery =
  /** Rebuild the relay and address this operation once more. */
  | "retry-after-reattach"
  /** Every remaining operation of this run is already lost; the failure is sticky from here. */
  | "stop-the-run"
  /** This one operation failed and the run carries on, which is what every ordinary failure is. */
  | "one-page";

/**
 * Grade a failed client invocation into what the run should do about it. Pure: two values in, one out.
 *
 * The whole judgement of the reconnect, in one total function, because it is the only part of it a test can
 * reach — `runRelayOperation` spawns a real client against the owner's real Chrome, so nothing below it is
 * unit-testable, and a decision buried in that control flow would be settled by a live run or not at all.
 *
 * The three answers, and why none of them collapses into another:
 *
 * - A failure that is not run-stopping costs one page today and still does. It never asks about a relay.
 * - A run-stopping failure a fresh attach cannot clear — a version-skewed client, where `Session.run`
 *   compares two constants for the life of that binary — stops the run at the first refusal rather than
 *   buying an attach per remaining page to be refused identically.
 * - A run-stopping failure a fresh attach MIGHT clear is retried, unless this run's one reconnect is
 *   already spent. Spent means the relay was rebuilt and dropped again immediately, which is a relay that
 *   is not coming back.
 *
 * @param diagnosis what the failed invocation was, from `browser/clientKill.ts`
 * @param reconnectSpent whether this run has rebuilt its relay since its last successful invocation
 * @returns what the run should do about this failure
 */
export function relayRecovery({
  diagnosis,
  reconnectSpent,
}: {
  diagnosis: ClientDiagnosis;
  reconnectSpent: boolean;
}): RelayRecovery {
  if (!diagnosis.runStopping) {
    return "one-page";
  }
  if (!diagnosis.reattachMayClear) {
    return "stop-the-run";
  }
  return reconnectSpent ? "stop-the-run" : "retry-after-reattach";
}

/** A failed client invocation, carrying what it WAS beside the failure a caller returns. */
interface ClientAttemptFailure {
  readonly error: BrowserTransportError;
  readonly diagnosis: ClientDiagnosis;
}

/**
 * Run ONE declared operation through the terminal client and hand back everything it printed — rebuilding a
 * dropped relay once, rather than losing every page after it.
 *
 * The caller chooses an operation, never code. The snippet source is built here, written to the
 * transport's own scratch file and handed to `run-code`, so a reviewer reads the closed set in
 * {@link RelayOperation} and knows there is no other shape of thing this module can do to a page.
 *
 * ## The reconnect, and why it belongs at exactly this depth
 *
 * MEASURED on one seat: a 251-page Linear walk reached `147/251` and exited carrying
 * `Error: Session closed` out of `playwright-core/lib/tools/cli-client/session.js`'s `_rejectCallbacks`,
 * and a xero walk in the same sweep died on `Target page, context or browser has been closed`. Both
 * discarded every completed page, and a second attempt under a three-times-larger cap reproduced it — so the
 * ceiling is not the clock and raising it again buys nothing.
 *
 * Nothing about a walk's own state is lost when that happens. Every page is already its own child process
 * ({@link runClient}), the captures so far are in the walk's own array, and the relay lease is untouched.
 * The one thing that does not survive is the ATTACH, which {@link ensureAttached} knows how to rebuild. So
 * the recovery is a reconnect here rather than a resume up in each walk.
 *
 * **Below `withWalkStopNoted`, which is the half that makes it safe.** That register is applied OUTSIDE
 * this function — at `playwrightCli.ts`'s `visit` and at {@link runLeasedOperation} — so a drop recovered
 * here never reaches it, `live/resync/outcome.ts` never sees a stop, and a resync whose walk actually
 * finished is stamped. A drop NOT recovered returns the same `SESSION_LOST` it always did and still fails
 * the attempt. The verb's refusal to stamp a partial walk is untouched in both directions; the recovery is
 * reported on its own register instead (`walkStops.ts`'s `noteRelayRecovery`).
 *
 * A snippet can take the foreground too — `page.bringToFront()` before a second screenshot attempt raises
 * the walk's window over whatever the owner is reading — so the foreground is read before the client runs and
 * given back after, whichever way the client ended. `src/browser/foreground.ts` carries the rule.
 *
 * @param deps the consent token, the profile pin and the scratch directory
 * @param scratch the files this transport wrote for itself
 * @param session the transport's own mutable state, for the id of the walk's own window
 * @param operation the declared operation
 * @returns everything the client printed, or the typed reason it printed nothing usable
 */
function runRelayOperation({
  deps,
  scratch,
  session,
  operation,
}: {
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  session: RelaySession;
  operation: RelayOperation;
}): Result<string, BrowserTransportError> {
  return runRelayOperationDiagnosed({ deps, operation, scratch, session }).result;
}

/**
 * One {@link runRelayOperation}, with what each failed client invocation WAS kept beside the answer.
 *
 * `priorFailures` is the failure the reconnect already rebuilt for; `terminalFailure` is the one the
 * returned error came from, or `null` when the error is a failed re-attach (which no client produced) or
 * there is no error. A thrown self-close the reconnect retried reaches `selfClosedTab.ts` as both, so a page
 * that closes a freshly attached tab is graded the same whether the client threw or the snippet reported.
 */
export interface RelayOperationRun {
  /** What {@link runRelayOperation} returns. */
  readonly result: Result<string, BrowserTransportError>;
  /** Failures the reconnect already answered with a rebuild, in order. */
  readonly priorFailures: readonly ClientDiagnosis[];
  /** The failure `result`'s error came from, when a client invocation produced it. */
  readonly terminalFailure: ClientDiagnosis | null;
}

/**
 * Run one declared operation exactly as {@link runRelayOperation} does, returning the diagnoses too.
 *
 * MEASURED on the scheduled Hex resync: a page that closed its tab with the client
 * exiting 1 was retried here and failed again, and only the transport error left — so the page-visit path
 * could not tell a page that closes every tab from a relay that will not come back. Reproduce with
 * `slopweaver atlas hex refresh` (`selfClosedTab.ts` carries the walk).
 *
 * @param deps the consent token, the profile pin and the scratch directory
 * @param scratch the files this transport wrote for itself
 * @param session the transport's own mutable state, for the id of the walk's own window
 * @param operation the declared operation
 * @returns the answer, beside every client failure met on the way to it
 */
export function runRelayOperationDiagnosed({
  deps,
  scratch,
  session,
  operation,
}: {
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  session: RelaySession;
  operation: RelayOperation;
}): RelayOperationRun {
  const first = runOperationOnce({ deps, operation, scratch, session });
  if (first.isOk()) {
    session.reconnectSpent = false;
    return { priorFailures: [], result: ok(first.value), terminalFailure: null };
  }
  const recovery = relayRecovery({ diagnosis: first.error.diagnosis, reconnectSpent: session.reconnectSpent });
  if (recovery !== "retry-after-reattach") {
    return { priorFailures: [], result: err(first.error.error), terminalFailure: first.error.diagnosis };
  }
  const rebuilt = rebuildRelay({ deps, reason: first.error.diagnosis.because, scratch, session });
  if (rebuilt.isErr()) {
    return { priorFailures: [first.error.diagnosis], result: err(rebuilt.error), terminalFailure: null };
  }
  const second = runOperationOnce({ deps, operation, scratch, session });
  if (second.isErr()) {
    return {
      priorFailures: [first.error.diagnosis],
      result: err(second.error.error),
      terminalFailure: second.error.diagnosis,
    };
  }
  session.reconnectSpent = false;
  return { priorFailures: [first.error.diagnosis], result: ok(second.value), terminalFailure: null };
}

/**
 * Let go of a relay that has dropped and attach a fresh one, spending this run's reconnect.
 *
 * The old attach's owned-tab guard is DISPOSED rather than fired: disposing unregisters the handlers
 * (`tabGuard.ts`), and firing would run a `tab-close` against the relay that has just gone. That close is
 * deliberately not attempted at all — {@link closeOwnedTab} bounds each of its two client calls at
 * {@link VISIT_TIMEOUT_MS}, and `browser/clientKill.ts`'s measured hang class is a client waiting on a relay
 * that never answers, so asking a dead one to close a tab risks four minutes to learn nothing. The residue
 * is stated rather than claimed away: a relay that detached without taking its tab leaves one connect page
 * behind per reconnect, and {@link ensureAttached} guards the new tab from the moment it exists.
 *
 * Exported for the page-visit path, whose self-closing page reaches the same rebuild from a snippet's
 * reported failure rather than a thrown one (`selfClosedTab.ts`). There the tab is already gone
 * by the page's own hand, so not firing the guard is exactly right rather than a stated residue.
 *
 * @param deps the consent token and the profile pin the attach needs
 * @param scratch the files this transport wrote for itself
 * @param session the transport's own mutable state
 * @param reason what dropped, in the diagnosis's own recordable words
 * @returns nothing once a fresh relay is attached, or why the owner's browser could not be reached
 */
export function rebuildRelay({
  deps,
  scratch,
  session,
  reason,
}: {
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  session: RelaySession;
  reason: string;
}): Result<null, BrowserTransportError> {
  session.reconnectSpent = true;
  session.disposeGuard?.();
  session.disposeGuard = null;
  session.attached = false;
  session.agentWindowId = null;
  const attached = ensureAttached({ deps, scratch, session });
  if (attached.isErr()) {
    return attached;
  }
  noteRelayRecovery({ reason });
  return ok(null);
}

/**
 * One client invocation, with the foreground given back whichever way it ended.
 *
 * Split out of {@link runRelayOperation} so the retry runs the identical path rather than a second copy of
 * it, and so what a failure WAS survives long enough to be graded — {@link clientFailure} reduces a
 * diagnosis to a transport error, and by then the reconnect question can no longer be asked.
 *
 * @param deps the consent token, the profile pin and the scratch directory
 * @param scratch the files this transport wrote for itself
 * @param session the transport's own mutable state, for the id of the walk's own window
 * @param operation the declared operation
 * @returns everything the client printed, or the failure beside the diagnosis that produced it
 */
function runOperationOnce({
  deps,
  scratch,
  session,
  operation,
}: {
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  session: RelaySession;
  operation: RelayOperation;
}): Result<string, ClientAttemptFailure> {
  writeFileSync(scratch.snippetPath, relayOperationSnippet({ operation }), { mode: 0o600 });
  // A destructured default rather than `??`, so the substitution is written down — `no-silent-fallback`.
  const { foreground: run = realForegroundRun } = deps;
  const before = readForeground({ run });
  const boundMs = clientBoundMs({ operation });
  // Measured around the call, because the bound that fired and the time it took to fire are the two numbers
  // that separate a hang from a page that would not load — `browser/clientKill.ts` carries the finding.
  const startedAt = Date.now();
  try {
    return ok(
      runClient({
        args: [scratch.clientScript, `-s=${CHROME_CHANNEL}`, "run-code", "--filename", scratch.snippetPath, "--json"],
        chromePinPath: deps.chromePinPath,
        cwd: scratch.workDir,
        timeoutMs: boundMs,
        token: deps.extensionToken,
      }),
    );
  } catch (error: unknown) {
    const diagnosis = diagnoseClientFailure({
      boundMs,
      elapsedMs: Date.now() - startedAt,
      facts: readClientFailureFacts({ error }),
    });
    return err({
      diagnosis,
      error: clientFailure({ diagnosis, reason: errorMessage({ error }), url: operation.url }),
    });
  } finally {
    // A run that chose to show its window keeps whatever a `bringToFront` did to it: that is what the owner asked to see.
    if (walkPlacement({ deps, env: process.env }) === "background") {
      giveBackForeground({
        agentWindowId: session.agentWindowId,
        before,
        report: (line) => {
          logger.error({ msg: line });
        },
        run,
      });
    }
  }
}
/**
 * Hold the lease, refuse an address off it, attach, run one operation, remember a stop.
 *
 * The order is the lease FIRST, because the lease is what makes one run unable to land in another and
 * attaching before taking it can steal the daemon from a run that holds it legitimately.
 *
 * Lives here rather than in a transport because both Vanta transports had written it out identically, which
 * the `duplicate-windows` gate saw before a reviewer would have. A second copy of the ordering is a second
 * place for it to go wrong.
 *
 * @param session the transport's own mutable state
 * @param deps the transport's dependencies
 * @param scratch the files this transport wrote for itself
 * @param operation the declared operation
 * @param url the address the operation is for, checked against the lease before anything runs
 * @param offLeaseReason what a refusal says when the address is outside the lease's origins
 * @returns what the client printed, or the typed reason it printed nothing
 */
export function runLeasedOperation({
  session,
  deps,
  scratch,
  operation,
  url,
  offLeaseReason,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  operation: RelayOperation;
  url: string;
  offLeaseReason: string;
}): Result<string, BrowserTransportError> {
  // Noted HERE, the one ordering every console transport shares, so a stop reaches a scheduled resync
  // (`./walkStops.ts`) whichever transport produced it.
  return withWalkStopNoted({
    result: leasedOperation({ deps, offLeaseReason, operation, scratch, session, url }),
  });
}

/**
 * The same ordering for a one-page CAPTURE, which WAITS a bounded time for a live holder of the lease rather
 * than refusing at once — a capture is one page, and another run holding the relay for a minute is not a
 * reason to fail it (`relayLeaseHold.ts`).
 *
 * Every capture transport shares it, for the reason {@link runLeasedOperation} lives here: one copy of the
 * ordering is one place for it to go wrong. An address off the lease STOPS the session, so a caller that
 * tries again is refused the same way at once.
 *
 * @param session the transport's own mutable state
 * @param deps the transport's dependencies, including how it waits for the lease
 * @param scratch the files this transport wrote for itself
 * @param operation the declared operation, whose own `url` is checked against the lease before anything runs
 * @returns what the client printed and the lease it ran under, or the typed reason it printed nothing
 */
export async function runHeldOperation({
  session,
  deps,
  scratch,
  operation,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  operation: RelayOperation;
}): Promise<Result<{ readonly stdout: string; readonly lease: RelayLease }, BrowserTransportError>> {
  const held = await holdRelayLease({ deps, session });
  if (held.isErr()) {
    return err(held.error);
  }
  const lease = held.value;
  if (!isOnLeaseOrigin({ lease, url: operation.url })) {
    session.stopped = BrowserTransportErrors.offLeaseOrigin({
      reason: `the ${lease.platform} capture may only address ${lease.origins.join(", ")}`,
      url: operation.url,
    });
    return err(session.stopped);
  }
  const attached = ensureAttached({ deps, scratch, session });
  if (attached.isErr()) {
    return err(attached.error);
  }
  const stdout = runRelayOperation({ deps, operation, scratch, session });
  return stdout.isErr() ? err(stdout.error) : ok({ lease, stdout: stdout.value });
}

/** The body of {@link runLeasedOperation}, before its answer is noted. */
function leasedOperation({
  session,
  deps,
  scratch,
  operation,
  url,
  offLeaseReason,
}: {
  session: RelaySession;
  deps: PlaywrightCliDeps;
  scratch: WalkScratch;
  operation: RelayOperation;
  url: string;
  offLeaseReason: string;
}): Result<string, BrowserTransportError> {
  if (session.stopped !== null) {
    return err(session.stopped);
  }
  if (session.lease === null) {
    const taken = leaseFor({ deps });
    if (taken.isErr()) {
      return err(taken.error);
    }
    session.lease = taken.value;
  }
  if (!isOnLeaseOrigin({ lease: session.lease, url })) {
    return err(BrowserTransportErrors.offLeaseOrigin({ reason: offLeaseReason, url }));
  }
  const attached = ensureAttached({ deps, scratch, session });
  if (attached.isErr()) {
    session.stopped = attached.error;
    return err(attached.error);
  }
  const ran = runRelayOperation({ deps, operation, scratch, session });
  if (ran.isErr() && ran.error.code === "SESSION_LOST") {
    session.stopped = ran.error;
  }
  return ran;
}
