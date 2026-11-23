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
import type { SupervisorPinRecord } from "../../../sessions/supervisorPin.js";
import { forgetSupervisorPin, supervisorPinPath, writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { buildSupervisorLink } from "../../../supervisor/chain.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import type { SupervisorSessionDetection, VisibleSupervisorSession } from "../../../supervisor/session.js";

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
    forgetLoudly({ home, when: (record) => record.workspaceId !== pinnedWorkspaceId });
    return false;
  }
  const { session } = detection;
  try {
    writeSupervisorPin({
      record: { pinnedAtIso: nowIso, session, workspaceId: pinnedWorkspaceId, workspaceRef },
      ...(home === undefined ? {} : { home }),
    });
  } catch (error: unknown) {
    logger.error({
      msg: `cmux pin: the pin succeeded, but recording it for the supervisor depth guard failed — ${String(error)}`,
    });
    return false;
  }
  appendChainLink({ home, nowIso, pinnedWorkspaceId, session, workspaceRef });
  return true;
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
  return forgetLoudly({ home, when: (record) => record.workspaceId === unpinnedWorkspaceId });
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
 * @param pinnedWorkspaceId cmux's id for its workspace
 * @param workspaceRef the addressable ref a human can open
 * @param nowIso the instant the pin moved
 * @param home the state home (defaults to the resolved home)
 */
function appendChainLink({
  session,
  pinnedWorkspaceId,
  workspaceRef,
  nowIso,
  home,
}: {
  session: VisibleSupervisorSession;
  pinnedWorkspaceId: string;
  workspaceRef: string;
  nowIso: string;
  home: string | undefined;
}): void {
  const built = buildSupervisorLink({
    pinnedAtIso: nowIso,
    session,
    source: "pin",
    workspaceId: pinnedWorkspaceId,
    workspaceRef,
  });
  if ("refusal" in built) {
    logger.error({ msg: `cmux pin: the supervisor chain was not extended — ${built.refusal}` });
    return;
  }
  try {
    appendSupervisorLink({ link: built.link, ...(home === undefined ? {} : { home }) });
  } catch (error: unknown) {
    logger.error({
      msg: `cmux pin: the pin succeeded, but extending the supervisor chain failed — ${String(error)}`,
    });
  }
}
