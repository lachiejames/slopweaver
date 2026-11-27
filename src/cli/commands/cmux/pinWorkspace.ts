/**
 * The cmux arm of `cmux pin`, and `cmux unpin`, each as one critical section under the supervisor-pin lock
 * (`../../../supervisor/pinLock.ts`).
 *
 * The lock is the first effect each takes and is released in a `finally` on every path: no target is resolved, no
 * workspace listed, no record read and nothing pinned, unpinned or written before it is held. So the inventory, the
 * collision checks, the cmux pin and the record write are one step against any other Slopweaver verb moving the seat
 * from the same home, where before a second pin could pass the same checks in the gap before the first one pinned.
 *
 * Every effect is a seam, so a test drives each path with plain fakes and no socket; `./pin.ts` builds the real ones.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { RuntimeLockError } from "../../../admit/runtimeLock.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { CmuxError } from "../../../cmux/errors.js";
import { listedPinTarget, type PinRefusal, pinCollisionRefusal } from "../../../cmux/pin.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import type { SupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { type CmuxPinAppRecordedError, cmuxPinOverAppRecordRefusal } from "../../../supervisor/appPin.js";
import type { HoldSupervisorPinLock } from "../../../supervisor/pinLock.js";
import type { StaleRecordOutcome } from "./recordPin.js";

/** Why the cmux arm of `cmux pin` pinned nothing. */
export type CmuxWorkspacePinError =
  CmuxError | CmuxPinAppRecordedError | PinRefusal | RuntimeLockError | SessionHarnessError;

/** The effects the cmux arm of `cmux pin` takes, each injected. */
export interface CmuxWorkspacePinDeps {
  /** Takes the supervisor-pin lock, before anything else. */
  readonly holdPinLock: HoldSupervisorPinLock;
  /** Resolves a named workspace to its id, or this process's own when none is named. */
  readonly targetWorkspaceId: (options: {
    workspaceRef: string | undefined;
  }) => Promise<Result<string, CmuxError | SessionHarnessError>>;
  /** Every workspace cmux lists, pinned or not. */
  readonly listWorkspaces: () => Promise<Result<readonly CmuxWorkspaceSummary[], SessionHarnessError>>;
  /** The pin record, read strictly. */
  readonly readDisposition: () => SupervisorPinDisposition;
  readonly pinWorkspace: (options: { workspaceId: string }) => Promise<Result<void, CmuxError>>;
  /** Writes the record when the workspace pinned is this process's own; true when it wrote one. */
  readonly recordPin: (options: {
    ownWorkspaceId: string | undefined;
    pinnedWorkspaceId: string;
    workspaceRef: string;
    nowIso: string;
  }) => boolean;
  readonly nowIso: () => string;
}

/** What the cmux arm of `cmux pin` did: the ref it pinned, and whether it recorded this session as the supervisor. */
export interface CmuxWorkspacePinOutcome {
  readonly ref: string;
  readonly self: boolean;
}

/**
 * Pin a cmux workspace under the supervisor-pin lock, refusing a second pinned workspace and refusing while the pin
 * record names an app session, which cmux cannot see.
 *
 * @param workspaceRef the `--workspace` value, or `undefined` to pin this process's own workspace
 * @param deps the injected effects
 * @returns the ref pinned and whether this session was recorded, or the typed refusal
 */
export async function pinCmuxWorkspace({
  deps,
  workspaceRef,
}: {
  deps: CmuxWorkspacePinDeps;
  workspaceRef: string | undefined;
}): Promise<Result<CmuxWorkspacePinOutcome, CmuxWorkspacePinError>> {
  const lock = deps.holdPinLock();
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    const target = await deps.targetWorkspaceId({ workspaceRef });
    if (target.isErr()) {
      return err(target.error);
    }
    const workspaces = await deps.listWorkspaces();
    if (workspaces.isErr()) {
      return err(workspaces.error);
    }
    const named = listedPinTarget({ targetWorkspaceId: target.value, workspaces: workspaces.value });
    if (named.isErr()) {
      return err(named.error);
    }
    const refused = pinCollisionRefusal({ targetWorkspaceId: target.value, workspaces: workspaces.value });
    if (refused !== undefined) {
      return err(refused);
    }
    const own = await deps.targetWorkspaceId({ workspaceRef: undefined });
    const appRecorded = cmuxPinOverAppRecordRefusal({ disposition: deps.readDisposition() });
    if (appRecorded !== undefined) {
      return err(appRecorded);
    }
    const ref = named.value.workspaceRef;
    const pinned = await deps.pinWorkspace({ workspaceId: target.value });
    if (pinned.isErr()) {
      return err(pinned.error);
    }
    const self = deps.recordPin({
      nowIso: deps.nowIso(),
      ownWorkspaceId: own.isOk() ? own.value : undefined,
      pinnedWorkspaceId: target.value,
      workspaceRef: ref,
    });
    return ok({ ref, self });
  } finally {
    lock.value.release();
  }
}

/** The effects `cmux unpin` takes, each injected. */
export interface CmuxWorkspaceUnpinDeps {
  /** Takes the supervisor-pin lock, before anything else. */
  readonly holdPinLock: HoldSupervisorPinLock;
  /** Resolves a named workspace to its id, or this process's own when none is named. */
  readonly targetWorkspaceId: (options: {
    workspaceRef: string | undefined;
  }) => Promise<Result<string, CmuxError | SessionHarnessError>>;
  /** The label to print for a workspace id: its session handle, or the id when it will not resolve. */
  readonly label: (options: { workspaceId: string }) => Promise<string>;
  readonly unpinWorkspace: (options: { workspaceId: string }) => Promise<Result<void, CmuxError>>;
  /** Removes the pin record when it names the workspace just unpinned. */
  readonly forgetRecord: (options: { unpinnedWorkspaceId: string }) => StaleRecordOutcome;
}

/** What `cmux unpin` did: the workspace it unpinned, and what became of a record naming it. */
export interface CmuxWorkspaceUnpinOutcome {
  readonly label: string;
  readonly stale: StaleRecordOutcome;
}

/**
 * Unpin a cmux workspace under the supervisor-pin lock, and forget a pin record naming it. Idempotent: an
 * already-unpinned workspace is a no-op success.
 *
 * @param workspaceRef the `--workspace` value, or `undefined` to unpin this process's own workspace
 * @param deps the injected effects
 * @returns the label unpinned and what became of the record, or the one line saying why nothing was
 */
export async function unpinCmuxWorkspace({
  deps,
  workspaceRef,
}: {
  deps: CmuxWorkspaceUnpinDeps;
  workspaceRef: string | undefined;
}): Promise<Result<CmuxWorkspaceUnpinOutcome, { readonly message: string }>> {
  const lock = deps.holdPinLock();
  if (lock.isErr()) {
    return err({ message: lock.error.message });
  }
  try {
    const target = await deps.targetWorkspaceId({ workspaceRef });
    if (target.isErr()) {
      return err({ message: target.error.message });
    }
    const label = await deps.label({ workspaceId: target.value });
    const unpinned = await deps.unpinWorkspace({ workspaceId: target.value });
    if (unpinned.isErr()) {
      return err({ message: unpinned.error.message });
    }
    return ok({ label, stale: deps.forgetRecord({ unpinnedWorkspaceId: target.value }) });
  } finally {
    lock.value.release();
  }
}
