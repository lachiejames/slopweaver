/**
 * Closing a witness worker's workspace THROUGH the session harness, so the session ledger row its boot opened
 * (`./launch.ts`) is closed by the same act — never a raw cmux close the ledger cannot see.
 *
 * Every witness close goes here: the dispatch's own cleanups (`./session.ts` — a `dispatched` row that would not
 * append, a failed attempt being retired, a pickup that never left) and a settle's (`./settle.ts`), most often the
 * worker settling ITSELF from inside the workspace being closed. The harness handed in is the RECORDING one
 * (`../../sessionHarness/recordingHarness.ts`), which writes the row's `closed` event: before the park when the
 * workspace is the caller's own, because the process does not outlive it, and only off a park that went through for
 * any other.
 *
 * Which park is `parkCloseMode`'s, exactly as `handover park` decides it: `force` for the caller's own workspace —
 * cmux 0.65.2 refuses an unforced close of any workspace with a live process, and a worker closing itself IS one —
 * and `bounded` for any other, forced once only on a fresh screen proving the session idle at its prompt
 * (`../../sessions/closeForce.ts`). A park the screen HELD is a close that did not happen, so it is reported as a
 * failure the caller already carries (`CLEANUP_FAILED`, `PREVIOUS_ATTEMPT_OPEN`, `RECORD_FAILED`).
 *
 * A workspace the harness no longer finds — at the first resolve, or at the park's own re-resolve by id — is closed,
 * the state this exists to reach. The recorder writes nothing for a park that failed, so that case closes the row
 * here, by the session's id, through the same never-fatal ledger.
 *
 * A LIVE workspace is parked only while the ledger holds no open row for it, or holds it under the witness's own
 * key. The recorder closes whatever row currently owns the session it parks, so a workspace the ledger already
 * holds under ANOTHER key is another session's seat: it is left standing and reported, never closed, and no row
 * is written. A ledger that will not answer proves no other owner, so the close goes ahead and the
 * recorder's own warning carries the gap.
 *
 * **Stated residue, the recorder's own and not this module's:** a worker's self-close whose forced park then FAILS
 * on something other than not-found (the cmux socket down, say) leaves its row closed while the window still
 * stands, because the recorder wrote the close before the park. That is `recordingHarness.ts`'s deliberate
 * own-seat ordering, shared with `handover park`: recording after the park would lose the row on every
 * self-close that succeeds, the common case. The close still reports the failure (`CLEANUP_FAILED`), so the
 * window left open is named for a hand to close.
 *
 * **And the harness resolver's:** `../../cmux/workspaceRow.ts` drops a `workspace.list` row with no
 * `current_directory`, so such a row resolves `SESSION_NOT_FOUND` and would read here as a workspace already gone.
 * Every harness close shares that read, `handover park` included; a witness workspace is always created with a
 * `cwd`, so no live witness row of that shape has been seen.
 *
 * **And the ledger's:** the open-key check, the park and the append are reads then a write with no lock between
 * them, as in the recorder itself, so the guard holds while nothing ELSE writes the ledger mid-close — a close
 * retried after a crash, the case it exists for. A concurrent writer reopens it: two processes closing the same
 * gone row could both append, which the fold applies to a row already closed, moving only its `lastEventIso`
 * (`../../sessions/session.ts`'s `applyClosed`); and a row spawned for the same workspace id during the
 * park would be the one the recorder re-reads and closes, though cmux mints a fresh id per workspace.
 * Closing either needs a ledger lock rather than a better read. "Sequential" leans
 * on the production ledger's append writing before it returns (`appendSessionEvent` is synchronous): the append is
 * settled quietly, never awaited, exactly as the recorder settles its own, because an untrusted append that never
 * settles must not hang a close — so a ledger whose append commits LATER reopens the same window.
 */
import { parkCloseMode } from "../../handover/parkPolicy.js";
import type { SessionHarnessError } from "../../sessionHarness/errors.js";
import type { SessionLedgerDeps } from "../../sessionHarness/recordingHarness.js";
import type {
  HarnessCloseHold,
  HarnessParkMode,
  HarnessSession,
  SessionHarness,
} from "../../sessionHarness/sessionHarness.js";
import { absorb, describeThrown, settleQuietly } from "../../sessionHarness/untrustedSettle.js";
import type { WitnessDispatchedEvent } from "./types.js";

/** The workspace a witness close ends, as the `dispatched` row (or the launch) names it. */
export interface WitnessCloseTarget {
  readonly workspaceId: string;
  readonly workspaceRef: string;
  /** The session-ledger key the boot registered — the plan's `sessionName`; absent on a row that predates it. */
  readonly sessionKey: string | undefined;
}

/**
 * The close target a `dispatched` row names: its workspace, and the ledger key its boot registered.
 *
 * @param record the witness's `dispatched` row
 * @returns the target
 */
export function witnessCloseTargetOf({ record }: { record: WitnessDispatchedEvent }): WitnessCloseTarget {
  return { sessionKey: record.sessionName, workspaceId: record.workspaceId, workspaceRef: record.workspaceRef };
}

/** What one close attempt observed, in the order it can happen. */
export type WitnessCloseObservation =
  | { readonly kind: "resolve-failed"; readonly error: SessionHarnessError }
  | { readonly kind: "park-failed"; readonly error: SessionHarnessError; readonly own: boolean }
  | { readonly kind: "held"; readonly handle: string; readonly reason: HarnessCloseHold }
  | { readonly kind: "foreign-row"; readonly handle: string; readonly ownerKey: string }
  | { readonly kind: "parked" };

/** How a close observation ends: the failure text, and whether the ledger row must be closed here. */
export interface WitnessCloseDecision {
  readonly failure: string | undefined;
  readonly reconcileLedger: boolean;
}

/**
 * Which park a witness close takes — `force` only for the workspace this process provably runs in.
 *
 * @param callerWorkspaceId the workspace this process runs in (`CMUX_WORKSPACE_ID`); absent proves nothing is own
 * @param workspaceId the workspace being closed
 * @returns `force` for the caller's own workspace, `bounded` for any other
 */
export function witnessParkMode({
  callerWorkspaceId,
  workspaceId,
}: {
  callerWorkspaceId: string | undefined;
  workspaceId: string;
}): HarnessParkMode {
  return parkCloseMode({ hatchForced: false, own: callerWorkspaceId === workspaceId });
}

/**
 * Map one close observation to its ending, exhaustively.
 *
 * @param observation what the close saw
 * @returns the failure text (`undefined` once closed) and whether the ledger row is this module's to close
 */
export function witnessCloseDecision({ observation }: { observation: WitnessCloseObservation }): WitnessCloseDecision {
  switch (observation.kind) {
    case "parked": {
      // The recorder wrote the row's close.
      return { failure: undefined, reconcileLedger: false };
    }
    case "held": {
      return {
        failure: `${observation.handle} was held open (${observation.reason}): its screen did not prove it idle at its prompt, so it was not forced`,
        reconcileLedger: false,
      };
    }
    case "foreign-row": {
      return {
        failure: `${observation.handle} is held under another session's ledger row (${observation.ownerKey}), so this witness close left it standing`,
        reconcileLedger: false,
      };
    }
    case "resolve-failed": {
      if (observation.error.code === "SESSION_NOT_FOUND") {
        return { failure: undefined, reconcileLedger: true };
      }
      return { failure: observation.error.message, reconcileLedger: false };
    }
    case "park-failed": {
      if (observation.error.code === "SESSION_NOT_FOUND") {
        // An own session's close was recorded BEFORE the park, so only a foreign one is still open.
        return { failure: undefined, reconcileLedger: !observation.own };
      }
      return { failure: observation.error.message, reconcileLedger: false };
    }
    default: {
      const unhandled: never = observation;
      return unhandled;
    }
  }
}

/**
 * Close one witness workspace through the recording harness: resolve it by id, park it, and close the ledger row
 * here when the workspace was already gone.
 *
 * @param harness the RECORDING harness over a live host connection
 * @param ledger the same ledger that harness records into, for the already-gone case
 * @param target the workspace and the ledger key its boot registered
 * @param callerWorkspaceId the workspace this process runs in (`CMUX_WORKSPACE_ID`), when it runs in one
 * @returns `undefined` once the workspace is closed, or the failure text, a held park included
 */
export async function closeWitnessWorkspace({
  harness,
  ledger,
  target,
  callerWorkspaceId,
}: {
  harness: Pick<SessionHarness, "park" | "resolve">;
  ledger: SessionLedgerDeps;
  target: WitnessCloseTarget;
  callerWorkspaceId: string | undefined;
}): Promise<string | undefined> {
  const observation = await observeClose({ callerWorkspaceId, harness, ledger, target });
  const decision = witnessCloseDecision({ observation });
  if (decision.reconcileLedger) {
    closeRowOfGoneSession({ ledger, target });
  }
  return decision.failure;
}

/** Resolve, check the row the ledger holds the session under, then park, reporting what was observed. */
async function observeClose({
  callerWorkspaceId,
  harness,
  ledger,
  target,
}: {
  callerWorkspaceId: string | undefined;
  harness: Pick<SessionHarness, "park" | "resolve">;
  ledger: SessionLedgerDeps;
  target: WitnessCloseTarget;
}): Promise<WitnessCloseObservation> {
  const resolved = await harness.resolve({ handle: target.workspaceId });
  if (resolved.isErr()) {
    return { error: resolved.error, kind: "resolve-failed" };
  }
  const session = resolved.value.session;
  const ownerKey = foreignOwnerKey({ ledger, session, sessionKey: target.sessionKey });
  if (ownerKey !== undefined) {
    return { handle: session.handle, kind: "foreign-row", ownerKey };
  }
  const mode = witnessParkMode({ callerWorkspaceId, workspaceId: session.id });
  const parked = await harness.park({ mode, target: resolved.value });
  if (parked.isErr()) {
    return { error: parked.error, kind: "park-failed", own: mode === "force" };
  }
  if (parked.value.kind === "held") {
    return { handle: parked.value.session.handle, kind: "held", reason: parked.value.reason };
  }
  return { kind: "parked" };
}

/**
 * The key of the open row the ledger holds a live session under, when that is NOT the witness's own — the one case
 * a park would close another session's row. No open row, the witness's own key, or a ledger that will not answer
 * (a throw, or a non-string the recorder warns about itself) is `undefined`: nothing proves another owner.
 */
function foreignOwnerKey({
  ledger,
  session,
  sessionKey,
}: {
  ledger: SessionLedgerDeps;
  session: HarnessSession;
  sessionKey: string | undefined;
}): string | undefined {
  let openKey: unknown;
  try {
    openKey = ledger.openSessionKey({ session });
  } catch (error: unknown) {
    absorb({ value: error });
    return undefined;
  }
  if (typeof openKey !== "string" || openKey === sessionKey) {
    return undefined;
  }
  return openKey;
}

/**
 * The gone session as the ledger is asked about it: only its id and handle are what a row is bound by, and both
 * come from the `dispatched` row; the rest of a live session's fields describe nothing that still exists.
 */
function goneSessionOf({ target }: { target: WitnessCloseTarget }): HarnessSession {
  return Object.freeze({
    description: undefined,
    directory: "",
    groupId: "",
    handle: target.workspaceRef,
    id: target.workspaceId,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
  });
}

/**
 * Close the row of a session that is already gone, by its id — only while the ledger still holds it OPEN under
 * the witness's own key, so a close retried after one that went through writes nothing twice, and a
 * handle a cmux restart reused for another session's row never closes that one. Never fatal: a ledger that will
 * not read or write is one warning, the recorder's own contract. A target with no key predates boot registration.
 */
function closeRowOfGoneSession({ ledger, target }: { ledger: SessionLedgerDeps; target: WitnessCloseTarget }): void {
  const { sessionKey, workspaceId, workspaceRef } = target;
  if (sessionKey === undefined) {
    return;
  }
  // Typed by `settleQuietly`'s `onRejected`, the shape it is handed to.
  const lost: (error: unknown) => void = (error) => {
    try {
      absorb({
        value: ledger.warn({
          message: `session ledger: could not record the close of ${sessionKey} (${describeThrown({ error })}) — the workspace is gone; the ledger is missing this row's close`,
        }),
      });
    } catch (warnFailure: unknown) {
      // Nowhere left to say it: the sink that would carry this is the one that failed.
      absorb({ value: warnFailure });
    }
  };
  try {
    const openKey: unknown = ledger.openSessionKey({ session: goneSessionOf({ target }) });
    if (openKey !== sessionKey) {
      // Already closed, never opened, or another session's row: nothing of this witness's is left open.
      absorb({ value: openKey });
      return;
    }
    settleQuietly({
      onRejected: lost,
      returned: ledger.append({
        event: { kind: "closed", sessionId: workspaceId, sessionKey, tsIso: ledger.nowIso(), workspaceRef },
      }),
    });
  } catch (error: unknown) {
    lost(error);
  }
}
