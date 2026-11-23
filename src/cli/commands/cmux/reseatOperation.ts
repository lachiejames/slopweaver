/**
 * One live reseat per workspace, across processes: the lock every relaunch holds from its plan to its last read.
 *
 * ## Why a lock, and why this span
 *
 * A reseat reads a tab, stops the `claude` in it, waits for it to be gone and types a launch line. Two of them over
 * the same tab — the owner's hand `cmux reseat` beside a `fleet resume` attempt, or two attempts — each read the same session,
 * each stop it, and each type a line: the second lands in the composer the first just booted, as a prompt. Nothing
 * serialised them. So the lock is taken before anything is PLANNED, and the fleet pass holds
 * it through its wall re-check and journal line too, so no second reseat acts on a seat this one has not finished
 * judging.
 *
 * What it does NOT cover, stated: a caller picks its targets by reading each screen's wall first, outside any lock —
 * `--all`'s scan, the single-tab verb, `fleet resume`'s `readWalls`. Those reads change nothing, and their verdict is
 * read AGAIN under the lock before it can loosen a plan (`reseatPass.ts`'s `wallUnderLock`): a wall is
 * what lets a mid-turn session be stopped, and the seat may have been brought back while the caller waited.
 *
 * Nor does it span state homes: an operation lock lives under one `$SLOPWEAVER_HOME`, as every lock in
 * this repository does, so a reseat run with `--home` pointed at a SECOND home against the same live cmux is outside
 * it. One home drives the owner's cmux; a second is a test's, against its own fake socket. Keying the lock on the cmux socket
 * instead was weighed and not taken: the socket path is resolved three ways and was renamed by a cmux update
 * (`../../../cmux/socketPath.ts`), so two processes on one cmux can disagree about it, which would split the lock the
 * same way while hiding the split.
 *
 * Nor does it outlast an unknown send: a launch line whose `surface.send_text` timed out after its frame
 * was written ends the reseat RELAUNCH_FAILED and releases the lock, and cmux could still type that line late, over a
 * second reseat's. The socket retires the connection on that timeout and never replays a send, and the refusal names
 * the tab; holding the lock past the reseat's own end would need a deadline no frame promises.
 *
 * ## The lease never ages out while its holder lives
 *
 * A reseat that is still waiting on a stop or a read-back is still working, so a wall-clock threshold would hand its
 * seat to a second reseat mid-flight. `staleAfterMs` is positive infinity: a DEAD holder is taken over at once, a live
 * one is contention (`../../../admit/operationLockHeld.ts`). A dry run types nothing, so it takes no lock.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type ReseatContendedError, ReseatErrors, type ReseatLockFailedError } from "../../../sessions/reseatErrors.js";
import type { ReseatDeps } from "./reseatPass.js";

/** Why a reseat did not run: another one holds the workspace, or its lock could not be taken at all. */
export type ReseatLockRefusal = ReseatContendedError | ReseatLockFailedError;

/**
 * The operation-lock key for one workspace's reseat — its cmux id, which survives the renumbering a ref does not.
 *
 * @param workspaceId the workspace's cmux UUID
 * @returns the key the lock is taken under
 */
export function reseatLockKey({ workspaceId }: { workspaceId: string }): string {
  return `cmux-reseat:${workspaceId}`;
}

/**
 * Run one reseat of a workspace under its lock, released however the body ends. A dry run runs unlocked.
 *
 * @param deps the pass's effects, whose `acquireReseatLock` takes the lock
 * @param workspace the workspace the body reseats
 * @param body everything the reseat reads, stops, types and records
 * @returns the body's own value, or why it never ran
 */
export async function withReseatLock<T>({
  deps,
  workspace,
  body,
}: {
  deps: Pick<ReseatDeps, "acquireReseatLock" | "dryRun">;
  workspace: CmuxWorkspaceSummary;
  body: () => Promise<T>;
}): Promise<Result<T, ReseatLockRefusal>> {
  if (deps.dryRun) {
    return ok(await body());
  }
  const lock = deps.acquireReseatLock({ workspaceId: workspace.workspaceId });
  if (lock.isErr()) {
    const workspaceRef = workspace.workspaceRef;
    if (lock.error.code === "LOCK_CONTENDED") {
      return err(ReseatErrors.contended({ holder: lock.error.message, workspaceRef }));
    }
    return err(ReseatErrors.lockFailed({ cause: lock.error.message, workspaceRef }));
  }
  try {
    return ok(await body());
  } finally {
    lock.value.release();
  }
}
