/**
 * Record, after a successful pin, that THIS session now holds the supervisor pin — the write half of
 * `sessions/supervisorPin.ts`, shared by `cmux pin` and `cmux takeover`.
 *
 * It only ever records a pin of the CALLER'S OWN workspace. `cmux pin --workspace <other>` moves the pin onto
 * a workspace this process is not inside, so the session id to hand the depth guard is one this process does
 * not have — recording its own would scope the guard onto the wrong session, which is worse than recording
 * nothing. That pin, and `cmux unpin`, REMOVE a record naming the workspace the pin left, rather than leaving
 * it naming a former holder. `cmux takeover` always pins itself, so it always records.
 *
 * Recording never fails the pin. The pin is the real act and cmux has already accepted it; this is a
 * convenience the guard reads, and a write failure here must not make a successful takeover report an error.
 *
 * Two records come out of one pin, for two different questions. `sessions/supervisor-pin.json` is REPLACED
 * and answers "is this session the supervisor" for the depth guard. `sessions/supervisor-chain.jsonl` is
 * APPENDED and answers "which sessions have been", which is what `supervisor intake` walks to audit a week
 * (`../../../supervisor/chain.ts` carries the measurement that forced it).
 */
import { logger } from "../../../lib/logger.js";
import {
  type AppSupervisorPinRecord,
  appHeldPin,
  type CmuxSupervisorPinRecord,
  cmuxHeldPin,
  type SupervisorPinRecord,
  type SupervisorPinTarget,
} from "../../../sessions/supervisorPin.js";
import { forgetSupervisorPin, supervisorPinPath, writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import type { SupervisorSessionDetection, VisibleSupervisorSession } from "../../../supervisor/session.js";
import { buildSupervisorLink } from "../../../supervisor/supervisorLink.js";

/**
 * Write the supervisor-pin record when the workspace just pinned is the caller's own.
 *
 * The holder is whichever visible host this process runs in — a Claude Code session or a Codex thread — as the
 * caller DETECTED it once. A process carrying neither host's variable, or both, names no session, so it records
 * nothing, exactly as a pin of someone else's workspace does.
 *
 * @param ownWorkspaceId the workspace this process is running inside, or `undefined` when it could not be resolved
 * @param workspaceRef the pinned workspace's addressable ref, for a human reading the file
 * @param detection the visible session this process runs in, detected once at the verb's boundary
 * @param nowIso the instant to stamp the record with
 * @param home the state home (defaults to the resolved home)
 * @returns true when a record was written
 */
export function recordSupervisorPin({
  ownWorkspaceId,
  pinnedWorkspaceId,
  workspaceRef,
  detection,
  nowIso,
  home,
}: {
  ownWorkspaceId: string | undefined;
  pinnedWorkspaceId: string;
  workspaceRef: string;
  detection: SupervisorSessionDetection;
  nowIso: string;
  home?: string;
}): boolean {
  if (detection.kind !== "active" || ownWorkspaceId !== pinnedWorkspaceId) {
    // The pin moved to a workspace whose session this process cannot name, so a record naming any OTHER
    // workspace now names a session the pin has left.
    // Only a cmux record can name a workspace; an app record is never read as one.
    forgetLoudly({ home, when: (record) => cmuxRecordNames({ record, workspaceId: pinnedWorkspaceId }) === false });
    return false;
  }
  const { session } = detection;
  // A Codex holder's home rides on both records, so its rollout is read from the home it was written to.
  const codexHome = detection.codexHome === undefined ? {} : { codexHome: detection.codexHome };
  const record: CmuxSupervisorPinRecord = {
    pinnedAtIso: nowIso,
    session,
    workspaceId: pinnedWorkspaceId,
    workspaceRef,
    ...codexHome,
  };
  if (!writeLoudly({ home, record })) {
    return false;
  }
  appendChainLink({
    ...codexHome,
    home,
    nowIso,
    session,
    target: { kind: "cmux", workspaceId: pinnedWorkspaceId, workspaceRef },
  });
  return true;
}

/**
 * Write the supervisor-pin record naming the calling session the desktop app hosts.
 *
 * The caller must have verified the app session id is its own first (`verifyAppSessionOrigin`), because this
 * write is what the depth guard and the chair gate then read as the chair. It moves no cmux pin, launches
 * nothing and renames nothing: an app-hosted chair has no workspace to pin. It records no Codex home: its caller
 * holds the session, not the detection, so an app-hosted Codex chair's owner turns read as unrecorded until it does.
 *
 * @param appSessionId the desktop control plane's id for the caller's own hosted session, origin-verified
 * @param session the vendor session inside it, as detected at the verb's boundary
 * @param nowIso the instant to stamp the record with
 * @param home the state home (defaults to the resolved home)
 * @returns true when a record was written
 */
export function recordAppSupervisorPin({
  appSessionId,
  session,
  nowIso,
  home,
}: {
  appSessionId: string;
  session: VisibleSupervisorSession;
  nowIso: string;
  home?: string;
}): boolean {
  const record: AppSupervisorPinRecord = { appSessionId, pinnedAtIso: nowIso, session };
  if (!writeLoudly({ home, record })) {
    return false;
  }
  appendChainLink({ home, nowIso, session, target: { appSessionId, kind: "app" } });
  return true;
}

/** Whether a record is the cmux arm naming this workspace; `undefined` for an app record, which names none. */
function cmuxRecordNames({
  record,
  workspaceId,
}: {
  record: SupervisorPinRecord;
  workspaceId: string;
}): boolean | undefined {
  const cmux = cmuxHeldPin({ pin: record });
  return cmux === undefined ? undefined : cmux.workspaceId === workspaceId;
}

/** Replace the pin record, logging rather than throwing: the pin move it records cannot be rolled back. */
function writeLoudly({ home, record }: { home: string | undefined; record: SupervisorPinRecord }): boolean {
  try {
    writeSupervisorPin({ record, ...(home === undefined ? {} : { home }) });
    return true;
  } catch (error: unknown) {
    logger.error({
      msg: `cmux pin: the pin succeeded, but recording it for the supervisor depth guard failed — ${String(error)}`,
    });
    return false;
  }
}

/**
 * After a successful unpin, remove the supervisor-pin record when it names the workspace just unpinned.
 *
 * @param unpinnedWorkspaceId cmux's id for the workspace the pin was taken off
 * @param home the state home (defaults to the resolved home)
 * @returns removed, absent when no record named that workspace, or failed when one did and would not go
 */
export function forgetUnpinnedSupervisor({
  unpinnedWorkspaceId,
  home,
}: {
  unpinnedWorkspaceId: string;
  home?: string;
}): StaleRecordOutcome {
  return forgetLoudly({
    home,
    when: (record) => cmuxRecordNames({ record, workspaceId: unpinnedWorkspaceId }) === true,
  });
}

/**
 * Take the supervisor seat off an app session: remove the pin record when, and only when, it is the app arm naming
 * exactly that session. The app session's counterpart of a cmux unpin, which cmux cannot do for a session it never
 * hosted.
 *
 * @param appSessionId the app session the seat is being taken from
 * @param home the state home (defaults to the resolved home)
 * @returns removed, absent when no record named that session, or failed when one did and would not go
 */
export function forgetAppSupervisor({
  appSessionId,
  home,
}: {
  appSessionId: string;
  home?: string;
}): StaleRecordOutcome {
  return forgetLoudly({ home, when: (record) => appHeldPin({ pin: record })?.appSessionId === appSessionId });
}

/** What removing a stale supervisor-pin record came to. */
export type StaleRecordOutcome = "removed" | "absent" | "failed";

/**
 * Remove a stale supervisor-pin record, saying so on stderr when it would not go. The pin has already moved, so
 * this never undoes it; `cmux unpin` turns `failed` into its exit code, because a stale record is what lets a
 * former chair pass the chair gate while cmux is silent.
 *
 * @param home the state home (defaults to the resolved home)
 * @param when whether the current record is the one the pin just left
 * @returns removed, absent, or failed
 */
function forgetLoudly({
  home,
  when,
}: {
  home: string | undefined;
  when: (record: SupervisorPinRecord) => boolean;
}): StaleRecordOutcome {
  try {
    return forgetSupervisorPin({ when, ...(home === undefined ? {} : { home }) }) ? "removed" : "absent";
  } catch (error: unknown) {
    logger.error({
      msg:
        `cmux pin: the pin moved, but the supervisor-pin record it left stale could not be removed — ` +
        `${String(error)}; remove ${supervisorPinPath(home === undefined ? {} : { home })} by hand`,
    });
    return "failed";
  }
}

/**
 * Append this pin to the supervisor-chain journal, so a later audit can read the session after it has been
 * replaced in the pin record.
 *
 * Separate from the pin write and never able to fail it: the pin record is what the depth guard reads on
 * every tool call, and a successful takeover must not report an error because an audit journal would not
 * take a line. A missed link shows up as a chain gap, which `../../../supervisor/chain.ts`'s coverage states
 * out loud — and `slopweaver supervisor chain --rescan` recovers it from the transcript.
 *
 * @param session the visible session that just took the pin
 * @param target where it is hosted: its cmux workspace or its desktop-app session
 * @param nowIso the instant the pin moved
 * @param home the state home (defaults to the resolved home)
 * @param codexHome a Codex holder's absolute `CODEX_HOME`, when its process named one
 */
function appendChainLink({
  session,
  target,
  nowIso,
  home,
  codexHome,
}: {
  session: VisibleSupervisorSession;
  target: SupervisorPinTarget;
  nowIso: string;
  home: string | undefined;
  codexHome?: string;
}): void {
  const built = buildSupervisorLink({
    pinnedAtIso: nowIso,
    session,
    source: "pin",
    target,
    ...(codexHome === undefined ? {} : { codexHome }),
  });
  if (built.isErr()) {
    logger.error({ msg: `cmux pin: the supervisor chain was not extended — ${built.error.message}` });
    return;
  }
  try {
    appendSupervisorLink({ link: built.value, ...(home === undefined ? {} : { home }) });
  } catch (error: unknown) {
    logger.error({
      msg: `cmux pin: the pin succeeded, but extending the supervisor chain failed — ${String(error)}`,
    });
  }
}
