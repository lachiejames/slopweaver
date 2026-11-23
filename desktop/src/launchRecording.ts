/**
 * The order a launching session is recorded in the recovery journal, with every effect injected: its process group
 * the moment its worker runs, then — only once it reports ready — its vendor transcript, and only then is the launch
 * answered. A row that cannot be written fails the launch, because the app would otherwise host a session it could
 * neither resume nor recognise the processes of after a crash. `sessionLaunch.ts` supplies the real journal and
 * worker; a test supplies plain functions.
 */
import type { Result } from "neverthrow";

import type { AppLaunchSpec } from "./sessionControlProtocol";
import { expectedExecutablesOf, type SessionClosedRow, type SessionRecoveryEvent } from "./sessionRecoveryRecord";
import type { WorkerLaunchConfig } from "./sessionWorker/workerWire";

/** How a launching worker settled: up, with the vendor's id for its transcript, or not, and why. */
export type WorkerSettled =
  { readonly kind: "ready"; readonly vendorSessionId: string } | { readonly kind: "failed"; readonly why: string };

/** How a session's process group ended: whether it needed SIGKILL, and whether the kernel no longer lists it. */
export interface GroupEnded {
  readonly killed: boolean;
  readonly gone: boolean;
}

/** What recording a launch reaches outside itself. */
export interface LaunchRecordingSeams {
  /** Append one row, synced to disk before it returns. */
  readonly record: (options: { readonly event: SessionRecoveryEvent }) => Result<void, string>;
  /** Wait for the worker to report ready, fail or exit. */
  readonly settle: () => Promise<WorkerSettled>;
  /** The instant a row is stamped with. */
  readonly now: () => string;
  /** The app's own executable, which runs the worker. */
  readonly execPath: string;
}

/**
 * Record one launching session while it comes up.
 *
 * @param sessionId the control plane's id
 * @param spec the launch it was asked for, recorded whole: paths only, never a credential
 * @param config the worker's configuration — a Claude one carries the transcript id the app minted
 * @param pid the worker's pid, which leads its process group; `undefined` when it never started
 * @param seams the journal, the worker's settling and the clock
 * @returns `undefined` once both rows are on disk and the session is up, else why the launch must be refused
 */
export async function recordLaunch({
  sessionId,
  spec,
  config,
  pid,
  seams,
}: {
  sessionId: string;
  spec: AppLaunchSpec;
  config: WorkerLaunchConfig;
  pid: number | undefined;
  seams: LaunchRecordingSeams;
}): Promise<string | undefined> {
  if (pid === undefined) {
    return "the session's worker did not start, so it has no process group to record";
  }
  const grouped = seams.record({
    event: {
      atIso: seams.now(),
      expectedExecutables: expectedExecutablesOf({ config, execPath: seams.execPath }),
      kind: "group-started",
      pgid: pid,
      sessionId,
    },
  });
  if (grouped.isErr()) {
    return grouped.error;
  }
  const settled = await seams.settle();
  if (settled.kind === "failed") {
    return settled.why;
  }
  const { vendorSessionId } = settled;
  if (config.vendor === "claude" && vendorSessionId !== config.vendorSessionId) {
    return `the session reported transcript ${vendorSessionId}, not the ${config.vendorSessionId} the app minted`;
  }
  const resumed = config.resumeVendorSessionId;
  if (resumed !== undefined && vendorSessionId !== resumed) {
    return `the session reported transcript ${vendorSessionId}, not the ${resumed} it was resuming`;
  }
  const opened = seams.record({ event: { atIso: seams.now(), kind: "opened", sessionId, spec, vendorSessionId } });
  return opened.isErr() ? opened.error : undefined;
}

/**
 * Who one stop answers to, gathered from every caller that joined it. Both facts only ever turn true: a stop somebody
 * asked for stays asked for whatever crash or failure report joins it, and a stop a failure joined ends failed
 * whoever began it.
 */
export interface StopCause {
  /** Somebody asked for the stop — a card's Stop, a close — so the session must never be resumed. */
  readonly markAsked: () => void;
  /** A failure joined the stop — a worker's report, a refused launch — so its card ends failed. */
  readonly markFailed: () => void;
  /** Whether anybody asked for the stop, read at the moment it decides. */
  readonly asked: () => boolean;
  /** Whether the stop ends failed, read at the moment it decides. */
  readonly failed: () => boolean;
}

/**
 * The cause of one stop, begun by its first caller.
 *
 * @param failed whether that caller is a failure's cleanup rather than a stop somebody asked for
 * @returns the cause, which every joining caller marks and the stop reads as it decides
 */
export function stopCause({ failed }: { failed: boolean }): StopCause {
  let isAsked = !failed;
  let isFailed = failed;
  return {
    asked: () => isAsked,
    failed: () => isFailed,
    markAsked: () => {
      isAsked = true;
    },
    markFailed: () => {
      isFailed = true;
    },
  };
}

/**
 * The closed row a finished stop earns. `closed` means "somebody asked this session to end and it did", the one fact
 * a later run needs so it never resumes a session the owner stopped. So it is written when somebody asked for the
 * stop — even if the worker crashed or reported a failure on the way out, since the session was meant to end anyway —
 * the stop began holding the session's group, and the group is proven gone. A stop only a failure's cleanup asked for
 * (a crash, a failure report, a refused launch) leaves a session a later run may resume; a group that survived leaves
 * one whose processes it must not believe ended; a stop that began with no group (a close racing a launch still
 * starting) proved nothing about one.
 *
 * @param sessionId the control plane's id
 * @param asked somebody asked for the stop, rather than only a failure's cleanup
 * @param heldPgid the group the session held when the stop began, `undefined` when it held none
 * @param ended how the stop's sweep of the session's group ended
 * @param atIso the instant the row is stamped with
 * @returns the row, or `undefined` for a stop nobody asked for, one that began with no group, or one not proven gone
 */
export function closedRowAfter({
  sessionId,
  asked,
  heldPgid,
  ended,
  atIso,
}: {
  sessionId: string;
  asked: boolean;
  heldPgid: number | undefined;
  ended: GroupEnded;
  atIso: string;
}): SessionClosedRow | undefined {
  const provenClosed = asked && heldPgid !== undefined && ended.gone;
  return provenClosed ? { atIso, kind: "closed", sessionId } : undefined;
}

/** What journalling a finished stop's closed row left behind. */
export interface CloseRecorded {
  /** Why a row the stop earned could not be written, so the stop must not read done; `undefined` otherwise. */
  readonly unrecorded: string | undefined;
  /**
   * The group proven gone with no closed row on disk yet — a crash's or failure's cleanup nobody asked for, or a stop
   * that earned a row and could not write it. A later stop somebody asks for holds no group any more, the group being
   * gone already, and pays the row with this one.
   */
  readonly owedPgid: number | undefined;
}

/**
 * Journal the closed row a finished stop earns, if it earns one, paying any row the session owed.
 *
 * @param sessionId the control plane's id
 * @param asked somebody asked for the stop, rather than only a failure's cleanup
 * @param heldPgid the group the session held when the stop began, `undefined` when it held none
 * @param owedPgid the group an earlier end of the session proved gone with no closed row, `undefined` when none is
 * @param ended how the stop's sweep of the session's group ended
 * @param atIso the instant the row is stamped with
 * @param record append one row, synced to disk before it returns
 * @returns why a row the stop earned could not be written, and the debt left: a written row clears it, an unwritten
 *   one keeps it, and a stop that earned none owes its own group once that is proven gone
 */
export function recordClose({
  sessionId,
  asked,
  heldPgid,
  owedPgid,
  ended,
  atIso,
  record,
}: {
  sessionId: string;
  asked: boolean;
  heldPgid: number | undefined;
  owedPgid: number | undefined;
  ended: GroupEnded;
  atIso: string;
  record: LaunchRecordingSeams["record"];
}): CloseRecorded {
  const group = heldPgid ?? owedPgid;
  const row = closedRowAfter({ asked, atIso, ended, heldPgid: group, sessionId });
  if (row === undefined) {
    const provenGone = ended.gone && group !== undefined;
    return { owedPgid: provenGone ? group : owedPgid, unrecorded: undefined };
  }
  const recorded = record({ event: row });
  return recorded.isErr()
    ? { owedPgid: group, unrecorded: recorded.error }
    : { owedPgid: undefined, unrecorded: undefined };
}
