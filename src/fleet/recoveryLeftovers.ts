/**
 * What a Recovery pass closes so no throwaway session outlives it: an earlier pass's leftovers before this one opens
 * anything, and whatever a launch the app refused nonetheless left under its own key.
 *
 * **A session is the pass's own only by its key AND its directory.** Its ledger key is a Recovery key and it runs
 * inside this home's scratch, so a pass under one state home never closes another's.
 */
import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import { boundedReason, RECOVERY_KEY_PREFIX, type RecoveryAttempt } from "./recoveryCheck.js";
import type {
  RecoveryHost,
  RecoveryOpenFailure,
  RecoveryPassDeps,
  RecoveryScratch,
  RecoverySession,
} from "./recoveryPassDeps.js";

/** One attempt, and why the pass must stop after it when its session could not be settled. */
export interface AttemptDone {
  readonly attempt: RecoveryAttempt;
  readonly infrastructure?: string;
}

/** Whether the app still runs this session: neither of the two states an ended one is kept under. */
function isUp({ snapshot }: { snapshot: AppSessionSnapshot }): boolean {
  return snapshot.state !== "closed" && snapshot.state !== "failed";
}

/**
 * Close each of these sessions in turn, stopping at the first the app will not close.
 *
 * @param host the desktop app, as the pass reaches it
 * @param sessions the throwaway sessions to close
 * @returns nothing, or which session could not be closed
 */
export async function closeAll({
  host,
  sessions,
}: {
  host: RecoveryHost;
  sessions: readonly RecoverySession[];
}): Promise<string | undefined> {
  for (const session of sessions) {
    const closed = await host.close({ session });
    if (closed.isErr()) {
      return `the throwaway session ${session.handle} could not be closed: ${closed.error}`;
    }
  }
  return undefined;
}

/**
 * Remove the scratch every throwaway session ran in.
 *
 * @param scratch this home's Recovery scratch
 * @returns nothing, or why it could not be removed
 */
export function clearScratch({ scratch }: { scratch: RecoveryScratch }): string | undefined {
  const cleared = scratch.clear();
  if (cleared.isErr()) {
    return cleared.error.message;
  }
  return undefined;
}

/**
 * Close what an earlier pass left and clear its directories: the app's own sessions first, then any row the ledger
 * still holds open for a session the app no longer has.
 *
 * @param deps everything the pass does to the world
 * @returns nothing, or why the leftovers could not be settled
 */
export async function settleLeftovers({ deps }: { deps: RecoveryPassDeps }): Promise<string | undefined> {
  const { host, scratch } = deps;
  const listed = await host.list();
  if (listed.isErr()) {
    return listed.error;
  }
  const standing = listed.value.filter(
    (snapshot) =>
      isUp({ snapshot }) &&
      snapshot.ledgerKey.startsWith(RECOVERY_KEY_PREFIX) &&
      scratch.holds({ directory: snapshot.directory }),
  );
  const unclosed = await closeAll({ host, sessions: standing });
  if (unclosed !== undefined) {
    return unclosed;
  }
  const rows = host.leftOpen();
  if (rows.isErr()) {
    return rows.error;
  }
  const unsettled = await closeAll({ host, sessions: rows.value });
  if (unsettled !== undefined) {
    return unsettled;
  }
  return clearScratch({ scratch });
}

/**
 * A launch that left no session it named: close anything the app nonetheless holds under this attempt's own key and
 * in this home's scratch. A launch the app never answered may still open its card after that look, so the pass stops
 * there rather than open the next one beside it; the next pass closes it as a leftover.
 *
 * @param deps everything the pass does to the world
 * @param base the attempt's plan, id and vendor
 * @param ledgerKey the key the refused launch would have run under
 * @param failure what the app said of the launch
 * @returns the refused attempt, and why the pass must stop when it must
 */
export async function settleRefusedLaunch({
  deps,
  base,
  ledgerKey,
  failure,
}: {
  deps: RecoveryPassDeps;
  base: Pick<RecoveryAttempt, "alias" | "attemptId" | "vendor">;
  ledgerKey: string;
  failure: RecoveryOpenFailure;
}): Promise<AttemptDone> {
  const attempt: RecoveryAttempt = {
    ...base,
    outcome: "launch-refused",
    reason: boundedReason({ text: failure.message }),
  };
  const listed = await deps.host.list();
  if (listed.isErr()) {
    return { attempt, infrastructure: listed.error };
  }
  const stragglers = listed.value.filter(
    (snapshot) =>
      isUp({ snapshot }) && snapshot.ledgerKey === ledgerKey && deps.scratch.holds({ directory: snapshot.directory }),
  );
  const unclosed = await closeAll({ host: deps.host, sessions: stragglers });
  if (unclosed !== undefined) {
    return { attempt, infrastructure: unclosed };
  }
  if (failure.unanswered === true) {
    return {
      attempt,
      infrastructure: `the app never answered the launch on ${base.alias}, so its card may still open; the check stopped rather than open another beside it`,
    };
  }
  return { attempt };
}
