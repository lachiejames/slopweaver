/**
 * The cmux harness's pure translations: a cmux workspace row to a {@link HarnessSession} and back, a target
 * to cmux's id-keyed address, and a {@link CmuxError} into the harness's own union with its message kept.
 *
 * The reverse mapping exists for the callers still speaking cmux's shape — `cmux list --json`, whose readers
 * key on `workspaceRef`/`workspaceId`/`windowId`, and the worktree-residue reap. It rebuilds the row with the
 * same key order `../cmux/workspaceRow.ts` decodes it in, so the JSON a reader sees is byte-identical.
 */
import type { CmuxTarget, CmuxWorkspaceSummary } from "../cmux/client.js";
import type { CmuxError } from "../cmux/errors.js";
import { type SessionHarnessError, SessionHarnessErrors, type SessionHarnessOperation } from "./errors.js";
import type { HarnessSession, HarnessTarget } from "./sessionHarness.js";

/**
 * One cmux workspace row as a harness session.
 *
 * @param workspace the row cmux reported
 * @returns the same session in the harness's vocabulary
 */
export function sessionFromCmux({ workspace }: { workspace: CmuxWorkspaceSummary }): HarnessSession {
  return {
    description: workspace.description,
    directory: workspace.currentDirectory,
    groupId: workspace.windowId,
    handle: workspace.workspaceRef,
    id: workspace.workspaceId,
    latestConversationMessage: workspace.latestConversationMessage,
    latestSubmittedAtIso: workspace.latestSubmittedAtIso,
    latestSubmittedMessage: workspace.latestSubmittedMessage,
    pinned: workspace.pinned,
    selected: workspace.selected,
    title: workspace.title,
  };
}

/**
 * A harness session back as the cmux workspace row it came from, keys in the order cmux's decoder writes them.
 *
 * @param session the session as the harness reported it
 * @returns the legacy row
 */
export function cmuxWorkspaceFromSession({ session }: { session: HarnessSession }): CmuxWorkspaceSummary {
  return {
    currentDirectory: session.directory,
    description: session.description,
    latestConversationMessage: session.latestConversationMessage,
    latestSubmittedAtIso: session.latestSubmittedAtIso,
    latestSubmittedMessage: session.latestSubmittedMessage,
    pinned: session.pinned,
    selected: session.selected,
    title: session.title,
    windowId: session.groupId,
    workspaceId: session.id,
    workspaceRef: session.handle,
  };
}

/**
 * The id-keyed cmux address a harness target writes to — never a ref, which cmux resolves to the FOCUSED
 * surface when it names nothing (`../cmux/client.ts`'s `CmuxTarget`).
 *
 * @param target the resolved harness target
 * @returns the cmux address
 */
export function cmuxTargetOf({ target }: { target: HarnessTarget }): CmuxTarget {
  return {
    ...(target.endpointId === undefined ? {} : { surfaceId: target.endpointId }),
    workspaceId: target.session.id,
  };
}

/**
 * A cmux failure as the harness's own, message kept verbatim: an unreachable socket is `HARNESS_UNAVAILABLE`,
 * a resolve cmux answered `not_found` is `SESSION_NOT_FOUND`, and everything else `HARNESS_OPERATION_FAILED`
 * carrying cmux's code.
 *
 * @param error what cmux returned
 * @param operation the contract operation it failed
 * @param handle the handle a resolve was asked for, when the operation resolved one (a resolve, or a park's re-resolve)
 * @returns the harness-domain failure
 */
export function harnessErrorFromCmux({
  error,
  operation,
  handle,
}: {
  error: CmuxError;
  operation: SessionHarnessOperation;
  handle?: string;
}): SessionHarnessError {
  if (error.code === "SOCKET_UNAVAILABLE") {
    return SessionHarnessErrors.unavailable({
      ...(error.reason === "access-denied" ? { accessDenied: true as const } : {}),
      causeCode: error.code,
      message: error.message,
      operation,
    });
  }
  if (handle !== undefined && error.code === "CALL_FAILED" && error.cmuxCode === "not_found") {
    return SessionHarnessErrors.sessionNotFound({ handle, message: error.message });
  }
  return SessionHarnessErrors.operationFailed({ causeCode: error.code, message: error.message, operation });
}
