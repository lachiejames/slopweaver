/**
 * The sessions this app hosts, held in one place with the effects that keep them true: the registry
 * (`sessionRegistry.ts` decides every state change), each session's worker process, the line its card shows under
 * the state, and the stop that ends a session's whole process group. `sessionControl.ts` answers requests over this.
 */
import { err, type Result } from "neverthrow";

import { type GroupEnded, recordClose, type StopCause, stopCause, type WorkerSettled } from "./launchRecording";
import { sessionCardFrameUrl, sessionCardUrl } from "./sessionCard";
import type { AppHarnessRefusalCode, AppSessionSnapshot } from "./sessionControlProtocol";
import { endGroupsBeforeExit, endProcessGroup, GROUP_GRACE_MS, REAL_GROUP_SIGNALS } from "./sessionProcessGroup";
import type { SessionRecoveryEvent } from "./sessionRecoveryRecord";
import { appendRecoveryRow } from "./sessionRecoveryStore";
import { reduceRegistry } from "./sessionRegistry";
import { EMPTY_REGISTRY, type RegistryEvent, type RegistryStep, type SessionRegistry } from "./sessionRegistryShape";
import { drawSessionCard } from "./sessionWindow";
import { isFromWorker } from "./sessionWorker/workerWire";
import type { launchSessionWorker } from "./sessionWorkerLaunch";

/** One session's worker process. */
export type Worker = ReturnType<typeof launchSessionWorker>;

/** A request the control plane will not carry out, with the protocol's code for why. */
export class SessionRefusal extends Error {
  constructor(
    readonly code: AppHarnessRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

let registry: SessionRegistry = EMPTY_REGISTRY;
const workers = new Map<string, Worker>();
const notes = new Map<string, string>();
/**
 * Every process group a worker led, kept until it is PROVEN gone — never just until its worker exits, because a worker
 * that dies leaves its adapter and Codex behind in the group, and the quit sweep can only end what is listed here.
 */
const groups = new Set<number>();
/** Each session's group, kept past its worker's record so a stop after an early exit still waits for the group. */
const groupOf = new Map<string, number>();
/** The recovery journal this run of the app writes, set once at boot (`sessionControlBoot.ts`). */
let recoveryJournal: string | undefined;

/**
 * Name the recovery journal every session's rows go to.
 *
 * @param path the journal (`sessionRecoveryStore.ts` `recoveryJournalPath`)
 */
export function recordRecoveryTo({ path }: { path: string }): void {
  recoveryJournal = path;
}

/**
 * The recovery journal this run of the app writes, once boot named it.
 *
 * @returns its path, or `undefined` before boot named one
 */
export function recoveryJournalNamed(): string | undefined {
  return recoveryJournal;
}

/**
 * Whether a process group is one this run of the app started and has not yet proven gone.
 *
 * @param pgid the group's id
 * @returns true while this run still holds it
 */
export function holdsGroup({ pgid }: { pgid: number }): boolean {
  return groups.has(pgid);
}

/**
 * Append one row to the recovery journal, synced before it returns.
 *
 * @param event the row
 * @returns nothing once it is on disk, or why it is not — no journal named counts as not
 */
export function recordRecovery({ event }: { event: SessionRecoveryEvent }): Result<void, string> {
  if (recoveryJournal === undefined) {
    return err(`no recovery journal was named at boot, so the ${event.kind} row could not be recorded`);
  }
  return appendRecoveryRow({ event, path: recoveryJournal });
}

/**
 * End one group and forget it only once it is gone.
 *
 * @param pgid the group's id — its worker's pid
 * @returns whether the group needed SIGKILL, and whether it is gone
 */
async function sweepGroup({ pgid }: { pgid: number }): Promise<GroupEnded> {
  const ended = await endProcessGroup({ graceMs: GROUP_GRACE_MS, pgid });
  if (ended.gone) {
    groups.delete(pgid);
  }
  return ended;
}

/** How a stop ended: its group's sweep, and why the closed row it earned could not be journalled, if it could not. */
export interface SessionEnded extends GroupEnded {
  readonly unrecorded: string | undefined;
}

/**
 * The sessions as they stand.
 *
 * @returns the registry
 */
export function hostedSessions(): SessionRegistry {
  return registry;
}

/**
 * Keep a worker for a session.
 *
 * @param sessionId the control plane's id
 * @param worker its process
 */
export function holdWorker({ sessionId, worker }: { sessionId: string; worker: Worker }): void {
  workers.set(sessionId, worker);
  if (worker.pid !== undefined) {
    groups.add(worker.pid);
    groupOf.set(sessionId, worker.pid);
  }
}

/**
 * Set the line a session's card shows under its state, and redraw it.
 *
 * @param sessionId the control plane's id
 * @param note what to say
 */
export function noteSession({ sessionId, note }: { sessionId: string; note: string }): void {
  notes.set(sessionId, note);
  redraw({ sessionId });
}

function redraw({ sessionId }: { sessionId: string }): void {
  const entry = registry.get(sessionId);
  if (entry !== undefined) {
    const shown = { note: notes.get(sessionId), snapshot: entry.snapshot };
    drawSessionCard({ frame: sessionCardFrameUrl(shown), sessionId, url: sessionCardUrl(shown) });
  }
}

/**
 * Apply one event: the registry moves, each worker gets its instructions, and the card is redrawn.
 *
 * @param event what happened
 * @returns the registry's step, a refused message's reason included
 */
export function applySessionEvent({ event }: { event: RegistryEvent }): RegistryStep {
  const step = reduceRegistry({ event, registry });
  registry = step.registry;
  for (const send of step.sends) {
    const worker = workers.get(send.sessionId);
    if (worker?.connected === true) {
      worker.send(send.instruction);
    }
  }
  redraw({ sessionId: "sessionId" in event ? event.sessionId : event.report.sessionId });
  return step;
}

/**
 * One session's snapshot, refused when the registry holds none.
 *
 * @param sessionId the control plane's id
 * @returns the snapshot
 */
export function snapshotOf({ sessionId }: { sessionId: string }): AppSessionSnapshot {
  const entry = registry.get(sessionId);
  if (entry === undefined) {
    throw new SessionRefusal("SESSION_NOT_FOUND", `no app session ${sessionId}`);
  }
  return entry.snapshot;
}

async function exited({ worker }: { worker: Worker }): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, GROUP_GRACE_MS * 2);
    worker.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Each session whose group is proven gone with no closed row on disk, by that group — a crash swept by its worker's
 * exit, a failure's cleanup, or a stop that could not write its row. A later close of the session holds no group, and
 * must write the row with this one rather than read as closed with nothing written, or write nothing at all.
 */
const closesOwed = new Map<string, number>();

/** Each session's stop while it runs, so a Stop pressed meanwhile answers once that stop settles rather than at once. */
const stopsUnderway = new Map<string, { readonly run: Promise<SessionEnded>; readonly cause: StopCause }>();

/**
 * Whether a session reads closed with nothing left for a Stop to do. The card reads closed as soon as the worker
 * reports its vendor session closed — before a stop proves the group gone, or while a crash's own sweep is still
 * ending it — so a Stop pressed then must still ask for a stop: no stop may be running, no group held, no row owed.
 *
 * @param sessionId the control plane's id
 * @returns true only once the session is closed, its group gone and every row it owes written
 */
export function closeSettled({ sessionId }: { sessionId: string }): boolean {
  return (
    registry.get(sessionId)?.snapshot.state === "closed" &&
    !stopsUnderway.has(sessionId) &&
    !groupOf.has(sessionId) &&
    !closesOwed.has(sessionId)
  );
}

/**
 * End one session: ask its worker to close the vendor session, then end its whole process group — swept either way,
 * because the worker leaving does not prove the adapter and app-server under it left with it.
 *
 * @param sessionId the control plane's id
 * @param failed end the session FAILED rather than closed — its worker reported a failure
 * @returns whether the group needed SIGKILL, whether it is gone — a group the kernel would not reap stays listed
 *   for the quit sweep, and the session ends failed with a note saying so, never quietly closed — and why the closed
 *   row the stop earned could not be journalled, which ends the session failed too
 */
export async function stopSession({
  sessionId,
  failed = false,
}: {
  sessionId: string;
  failed?: boolean;
}): Promise<SessionEnded> {
  // One stop at a time per session: a close arriving while one runs is handed that one, so every caller settles on
  // the same stop and none answers while another is still ending the session. A group that outlived it is swept
  // again by the next close once this one has settled. Each joining caller adds to the cause, never takes away from it.
  const underway = stopsUnderway.get(sessionId);
  if (underway !== undefined) {
    if (failed) {
      underway.cause.markFailed();
    } else {
      underway.cause.markAsked();
    }
    return underway.run;
  }
  const cause = stopCause({ failed });
  // `endSession` marks the session stopping before its first await, so the stop is recorded before anything else runs.
  const run = endSession({ cause, sessionId });
  stopsUnderway.set(sessionId, { cause, run });
  try {
    return await run;
  } finally {
    if (stopsUnderway.get(sessionId)?.run === run) {
      stopsUnderway.delete(sessionId);
    }
  }
}

async function endSession({ sessionId, cause }: { sessionId: string; cause: StopCause }): Promise<SessionEnded> {
  applySessionEvent({ event: { kind: "stopping", sessionId } });
  // Read before the first await: the worker's own exit handler forgets the group once its sweep proves it gone, and a
  // stop that began holding one must still be judged as having held it.
  const heldPgid = groupOf.get(sessionId);
  const worker = workers.get(sessionId);
  if (worker?.connected === true) {
    // A channel that closes between the check and the send reports to this callback, never as an unhandled `error`
    // event that would take the app down before the group sweep below has run.
    worker.send({ kind: "close" }, (failure) => {
      if (failure !== null) {
        notes.set(sessionId, `the close never reached the worker (${failure.message}); its group is ended instead`);
      }
    });
  }
  if (worker !== undefined) {
    await exited({ worker });
  }
  // The session's group, not its worker's record: a worker that already exited took its record with it, while the
  // adapter it left may still be running — a stopped one cannot even catch SIGTERM.
  const pgid = groupOf.get(sessionId);
  const ended = pgid === undefined ? { gone: true, killed: false } : await sweepGroup({ pgid });
  // Kept while the group survives, so a second close sweeps it again rather than reading "no group" as gone.
  if (ended.gone) {
    groupOf.delete(sessionId);
  }
  workers.delete(sessionId);
  if (!ended.gone) {
    notes.set(sessionId, `a process in group ${String(pgid)} outlived SIGKILL; the app ends it again at quit`);
  }
  // Recorded closed only when somebody asked for the stop, it began holding the session's group and that group is
  // gone: a crash's cleanup alone leaves a session a later run may resume. The cause is read now, not when the stop
  // began, so every caller that joined it counts.
  // A closed row it earned and could not write ends the session failed and the stop unrecorded: the group is gone and
  // cannot be brought back, but a later run would resume a session somebody stopped, so the stop must not read done.
  const { unrecorded, owedPgid } = recordClose({
    asked: cause.asked(),
    atIso: new Date().toISOString(),
    ended,
    heldPgid,
    owedPgid: closesOwed.get(sessionId),
    record: recordRecovery,
    sessionId,
  });
  if (owedPgid === undefined) {
    closesOwed.delete(sessionId);
  } else {
    closesOwed.set(sessionId, owedPgid);
  }
  if (unrecorded !== undefined) {
    notes.set(
      sessionId,
      `Stopped, but the journal could not record it closed (${unrecorded}); a later run may resume it`,
    );
  }
  applySessionEvent({
    event: {
      atIso: new Date().toISOString(),
      failed: cause.failed() || !ended.gone || unrecorded !== undefined,
      kind: "gone",
      sessionId,
    },
  });
  return { ...ended, unrecorded };
}

/**
 * Follow a worker's reports and its exit.
 *
 * @param sessionId the control plane's id
 * @param worker its process
 * @param settled told whether the session came up, with the vendor's transcript id, or why not; only the first counts
 */
export function watchWorker({
  sessionId,
  worker,
  settled,
}: {
  sessionId: string;
  worker: Worker;
  settled: (outcome: WorkerSettled) => void;
}): void {
  let stderrTail = "";
  /** Whether the worker reported ready, so the launch that waited on it is over. */
  let came = false;
  // Any other send that fails (a prompt to a worker whose channel just closed) lands here rather than crashing the app;
  // the worker's exit, which follows a closed channel, ends the session.
  worker.on("error", (failure: Error) => {
    notes.set(sessionId, `the session's worker channel failed: ${failure.message}`);
  });
  worker.stderr?.setEncoding("utf8");
  worker.stderr?.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-2_000);
  });
  worker.on("message", (value: unknown) => {
    if (!isFromWorker(value) || value.sessionId !== sessionId) {
      return;
    }
    if (value.kind === "failed") {
      notes.set(sessionId, value.message);
    }
    applySessionEvent({ event: { atIso: new Date().toISOString(), kind: "worker", report: value } });
    if (value.kind === "ready") {
      came = true;
      settled({ kind: "ready", vendorSessionId: value.vendorSessionId });
    } else if (value.kind === "failed" && came) {
      // A failure after the launch settled has nobody waiting on it, and a failed session's card shows no Stop: end
      // its group now, or a worker that reported and stayed up keeps the adapter and Codex running unseen.
      void stopSession({ failed: true, sessionId });
    } else if (value.kind === "failed") {
      settled({ kind: "failed", why: value.message });
    }
  });
  worker.on("exit", (code, signal) => {
    const why =
      `the session's worker exited (${String(code)}${signal === null ? "" : ` ${signal}`}) ${stderrTail}`.trim();
    settled({ kind: "failed", why });
    // The worker leaving does not take its adapter and Codex with it: end the group it led, whoever ends the session.
    const pgid = worker.pid;
    if (pgid !== undefined) {
      void sweepGroup({ pgid }).then(() => {
        // Proven gone with nobody's stop holding it: a close the owner asks for later still owes this group's row.
        const unheld = !groups.has(pgid) && groupOf.get(sessionId) === pgid;
        if (unheld) {
          groupOf.delete(sessionId);
          closesOwed.set(sessionId, pgid);
        }
        return unheld;
      });
    }
    if (workers.get(sessionId) !== worker) {
      return;
    }
    workers.delete(sessionId);
    const state = registry.get(sessionId)?.snapshot.state;
    if (state !== "stopping" && state !== "closed") {
      notes.set(sessionId, why);
      applySessionEvent({ event: { atIso: new Date().toISOString(), failed: true, kind: "gone", sessionId } });
    }
  });
}

/**
 * End every hosted session's process group, for an app that is quitting: nothing it started may outlive it. It
 * blocks, at most for the grace, because `will-quit` does not wait for anything asynchronous.
 */
export function endEverySession(): void {
  endGroupsBeforeExit({ graceMs: GROUP_GRACE_MS, pgids: [...groups], signals: REAL_GROUP_SIGNALS });
  groups.clear();
  groupOf.clear();
  workers.clear();
}
