/**
 * The effects of resuming a session (`sessionResume.ts` decides): the recovery journal read, the process table read,
 * and an owned group ended before the new worker starts. `sessionLaunch.ts` calls {@link readyToResume} and then
 * opens the session exactly as a new launch does, card first, with the recorded transcript handed to its worker.
 */
import { execFileSync } from "node:child_process";

import { err, ok, type Result } from "neverthrow";

import type { AppLaunchSpec } from "./sessionControlProtocol";
import { holdsGroup, hostedSessions, recordRecovery, recoveryJournalNamed } from "./sessionHosting";
import { GROUP_GRACE_MS, signalGroup, waitGone } from "./sessionProcessGroup";
import type { SessionGroupRow } from "./sessionRecoveryRecord";
import { readRecoveryJournal } from "./sessionRecoveryStore";
import { classifyRecoveryGroup, parseProcessTable, type RecoveryProcess, resumeTargetOf } from "./sessionResume";

/** How long one `ps` read may take before the resume is refused rather than left waiting on it. */
const PROCESS_TABLE_TIMEOUT_MS = 10_000;

/**
 * Every process on the machine, by pid, group, start time and executable. Read synchronously: the no-headless gate
 * allows no async child here, and a `ps` read is short and bounded by its own timeout.
 */
function processTable(): Result<readonly RecoveryProcess[], string> {
  let text: string;
  try {
    // The C locale fixes the start time's shape, which the parser reads as five fields, and UTC fixes its zone, so a
    // group leader's start compares with the row's `atIso`.
    text = execFileSync("/bin/ps", ["-axo", "pid=,pgid=,lstart=,comm="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      maxBuffer: 16 * 1024 * 1024,
      timeout: PROCESS_TABLE_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    return err(`the process table could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseProcessTable({ text });
}

/**
 * Whether the group is still listed, read from a table taken now: gone, or provably the session's own, or why not.
 * A process can exec something else between this read and the signal that follows it; reading afresh before every
 * signal narrows that window to the gap between `ps` exiting and `kill(2)`, which no POSIX call closes for a group.
 * After the first read, a process that read did not own (by pid and start time) refuses the group: the session's own
 * may have ended and the id gone to another process between reads, which the grace period's probes cannot see.
 */
function groupNow({
  group,
  known,
}: {
  group: SessionGroupRow;
  known: ReadonlySet<string> | undefined;
}): Result<{ kind: "gone" } | { kind: "owned"; identities: readonly string[] }, string> {
  const table = processTable();
  if (table.isErr()) {
    return err(table.error);
  }
  const held = classifyRecoveryGroup({
    expectedExecutables: group.expectedExecutables,
    pgid: group.pgid,
    processes: table.value,
    rowAtIso: group.atIso,
    ...(known === undefined ? {} : { known }),
  });
  if (held.kind === "ambiguous") {
    const named = held.strangers.map((process) => `${String(process.pid)} ${process.command}`).join("; ");
    return err(
      `process group ${String(group.pgid)} holds processes the session never ran (${named}), so it is left alone`,
    );
  }
  return ok(held);
}

/** End one recorded group, SIGTERM then SIGKILL, each sent only on a table read just before it. */
async function endRecordedGroup({ group }: { group: SessionGroupRow }): Promise<Result<void, string>> {
  let known: ReadonlySet<string> | undefined;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const now = groupNow({ group, known });
    if (now.isErr()) {
      return err(now.error);
    }
    if (now.value.kind === "gone") {
      return ok(undefined);
    }
    known = new Set(now.value.identities);
    // Asked in the same synchronous step as the signal: a launch running beside this one may have taken a reused
    // group id while the table was read, and nothing can take it between this check and `kill(2)`.
    if (holdsGroup({ pgid: group.pgid })) {
      return err(`process group ${String(group.pgid)} belongs to a session this run of the app is hosting`);
    }
    signalGroup({ pgid: group.pgid, signal });
    if (await waitGone({ ms: GROUP_GRACE_MS, pgid: group.pgid })) {
      return ok(undefined);
    }
  }
  return err(`process group ${String(group.pgid)} outlived SIGKILL, so the session is not resumed beside it`);
}

/**
 * Every recorded group row a resume in this run of the app read gone, by {@link groupRowKey}: the backstop for a
 * `group-ended` row that could not be written, so a retry in the same run never signals that id again either.
 */
const readGoneThisRun = new Set<string>();

/** One `group-started` row's identity: its session, its id and when it was written, so a newer worker's row differs. */
function groupRowKey({ group }: { group: SessionGroupRow }): string {
  return `${group.sessionId}\u0000${String(group.pgid)}\u0000${group.atIso}`;
}

/**
 * End every group the session's workers led that is still listed, when it is provably theirs; refuse otherwise. Each
 * group read gone is remembered for this run and journalled `group-ended` before the next is looked at, so a resume
 * retried after this one fails later on never signals that id again, nor does a later run once the row is on disk.
 *
 * @param groups the session's group rows, oldest first
 * @returns nothing once every group is gone and journalled so, or why one is not
 */
async function clearRecordedGroups({ groups }: { groups: readonly SessionGroupRow[] }): Promise<Result<void, string>> {
  // A group id proven gone once is done: a later row naming the same id (a resumed session's worker can be handed a
  // reused one) would otherwise read whoever took that id since as the session's own.
  const gone = new Set<number>();
  for (const group of groups) {
    if (gone.has(group.pgid) || readGoneThisRun.has(groupRowKey({ group }))) {
      continue;
    }
    const ended = await endRecordedGroup({ group });
    if (ended.isErr()) {
      return ended;
    }
    gone.add(group.pgid);
    // Remembered before the row is written, so a retry in this run skips the group even when the write below fails.
    readGoneThisRun.add(groupRowKey({ group }));
    const recorded = recordRecovery({
      event: { atIso: new Date().toISOString(), kind: "group-ended", pgid: group.pgid, sessionId: group.sessionId },
    });
    if (recorded.isErr()) {
      return err(`process group ${String(group.pgid)} is gone but ${recorded.error}, so the session is not resumed`);
    }
  }
  return ok(undefined);
}

/**
 * Whether a recorded session may be resumed now, its old process groups ended: the vendor transcript it continues.
 *
 * @param sessionId the app's own id for the session, as the spawn's open ledger row records it
 * @param spec the launch the spawn asks for now
 * @returns the vendor transcript id, or why the session is not resumed
 */
export async function readyToResume({
  sessionId,
  spec,
}: {
  sessionId: string;
  spec: AppLaunchSpec;
}): Promise<Result<string, string>> {
  // Any state, a failed or closed one included: a close can journal a session only while this run hosts it, so a
  // session hosted nowhere here cannot be journalled closed between these checks and its worker starting.
  const state = hostedSessions().get(sessionId)?.snapshot.state;
  if (state !== undefined) {
    return err(`session ${sessionId} is ${state} in this run of the app, so it is not resumed beside that`);
  }
  const path = recoveryJournalNamed();
  if (path === undefined) {
    return err("no recovery journal was named at boot, so nothing can be resumed from it");
  }
  const journal = await readRecoveryJournal({ path });
  if (journal.isErr()) {
    return err(journal.error);
  }
  const target = resumeTargetOf({ journal: journal.value, sessionId, spec });
  if (target.isErr()) {
    return err(target.error);
  }
  const cleared = await clearRecordedGroups({ groups: target.value.groups });
  return cleared.map(() => target.value.vendorSessionId);
}
