/**
 * Ending a witness — the settle half of the noun's two ORDERING claims; `./session.ts` boots the worker.
 *
 * Under the dispatch's own per-home lock, plan the terminal from the fold and append it — so a terminal never
 * lands between a dispatch's read and its `dispatched` row — and only THEN close a dispatched workspace. The
 * terminal is what stops a duplicate post, so it must survive a close that fails, and a cleanup failure is
 * reported after the terminal is already durable.
 *
 * The one-at-a-time cap counts INVESTIGATIONS, and an investigation ends at its terminal, not at its close.
 * The close parks through the recording harness (`./close.ts`): a worker settling itself is force-parked, its
 * session-ledger row recorded closed BEFORE the park because the process does not outlive it.
 * A worker settles itself as its last act from inside the workspace the close ends, so a close that fails
 * (`CLEANUP_FAILED`) leaves a finished worker's window open for a hand to close. It never holds the next
 * dispatch, because a cap waiting on cmux cleanup would stop every later witness on one socket error. That is the ruling's scope rather than a gap in it.
 */
import { err, ok, type Result } from "#lib/result.js";
import { witnessCloseTargetOf } from "./close.js";
import { type WitnessSettleError, WitnessSettleErrors } from "./errors.js";
import { foldWitnessJournal, planWitnessSettlement } from "./journal.js";
import type { WitnessJournalDeps } from "./session.js";
import type { WitnessDispatchedEvent, WitnessSelector, WitnessSettledEvent, WitnessSettleOutcome } from "./types.js";

/** Which witness a settle ends, how it ended, and what the ending rests on. */
interface WitnessSettleRequest {
  readonly selector: WitnessSelector;
  readonly outcome: WitnessSettleOutcome;
  readonly why: string | undefined;
  readonly postedTs: string | undefined;
}

/** The durable half's result: the appended terminal and the `dispatched` row it ends, when there is one. */
interface WitnessRecorded {
  readonly event: WitnessSettledEvent;
  readonly dispatched: WitnessDispatchedEvent | undefined;
}

/** What a successful settle reports. */
export interface WitnessSettled {
  readonly event: WitnessSettledEvent;
  /** The worker's workspace the settle closed, or `undefined` when no worker was ever dispatched. */
  readonly closedWorkspaceRef: string | undefined;
}

/**
 * Plan a settle's terminal against the journal as it stands and append it — the durable half, with no close.
 *
 * Split from {@link closeSettledWitness} because the worker usually settles ITSELF, from inside the workspace
 * the close would end: the CLI appends and prints its result first, and only then closes.
 *
 * @param request which witness, how it ended, and what the ending rests on
 * @param deps the effects
 * @returns the appended terminal and the dispatched record it ends, or the refusal
 */
export function recordWitnessSettlement({
  request,
  deps,
}: {
  request: WitnessSettleRequest;
  deps: Pick<WitnessJournalDeps, "append" | "lock" | "nowIso" | "readJournal">;
}): Result<WitnessRecorded, WitnessSettleError> {
  // Under the dispatch's own lock: a terminal appended while a dispatch is mid-launch would see no worker,
  // close nothing, and leave the worker the launch then records uncounted by the cap.
  const held = deps.lock();
  if (held.isErr()) {
    return err(WitnessSettleErrors.locked({ reason: held.error }));
  }
  try {
    return recordHeld({ deps, request });
  } finally {
    held.value.release();
  }
}

/** The settle's read and append, run only while the lock is held. */
function recordHeld({
  request,
  deps,
}: {
  request: WitnessSettleRequest;
  deps: Pick<WitnessJournalDeps, "append" | "nowIso" | "readJournal">;
}): Result<WitnessRecorded, WitnessSettleError> {
  const events = deps.readJournal();
  if (events.isErr()) {
    return err(WitnessSettleErrors.journal({ cause: events.error }));
  }
  const current = foldWitnessJournal({ events: events.value });
  const planned = planWitnessSettlement({ current, nowIso: deps.nowIso(), ...request });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const appended = deps.append({ event: planned.value });
  if (appended.isErr()) {
    return err(WitnessSettleErrors.journal({ cause: appended.error }));
  }
  return ok({ dispatched: current.get(planned.value.witnessId)?.dispatched, event: planned.value });
}

/**
 * Close a settled witness's workspace — only when a worker was ever dispatched, and only after its terminal
 * is durable.
 *
 * @param dispatched the witness's `dispatched` row, or `undefined` when none exists (nothing to close)
 * @param deps the close seam
 * @returns the closed workspace ref (`undefined` when nothing was dispatched), or the cleanup failure
 */
export async function closeSettledWitness({
  dispatched,
  deps,
}: {
  dispatched: WitnessDispatchedEvent | undefined;
  deps: Pick<WitnessJournalDeps, "closeWorkspace">;
}): Promise<Result<string | undefined, WitnessSettleError>> {
  if (dispatched === undefined) {
    return ok(undefined);
  }
  const failure = await deps.closeWorkspace(witnessCloseTargetOf({ record: dispatched }));
  if (failure !== undefined) {
    return err(
      WitnessSettleErrors.cleanupFailed({
        reason: failure,
        witnessId: dispatched.witnessId,
        workspaceRef: dispatched.workspaceRef,
      }),
    );
  }
  return ok(dispatched.workspaceRef);
}

/**
 * Settle one witness end to end: plan, append the terminal, then close a dispatched workspace.
 *
 * @param request which witness, how it ended, and what the ending rests on
 * @param deps the effects
 * @returns the terminal and the workspace it closed, or the refusal — a `CLEANUP_FAILED` only ever after the
 *   terminal is already durable
 */
export async function settleWitness({
  request,
  deps,
}: {
  request: WitnessSettleRequest;
  deps: WitnessJournalDeps;
}): Promise<Result<WitnessSettled, WitnessSettleError>> {
  const recorded = recordWitnessSettlement({ deps, request });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  const closed = await closeSettledWitness({ deps, dispatched: recorded.value.dispatched });
  if (closed.isErr()) {
    return err(closed.error);
  }
  return ok({ closedWorkspaceRef: closed.value, event: recorded.value.event });
}
