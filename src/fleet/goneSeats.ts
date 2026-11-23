/**
 * The seats the newest recovery attempt refused, held or left mid-relaunch whose cmux workspace no longer exists —
 * the one fact that clears a finished attempt's verdict without another attempt.
 *
 * ## Why this is a journal line, and why `session close-done` writes it
 *
 * `fleet health` derives its state from the newest attempt's record, and before this the only thing that superseded
 * one was a later attempt finishing. MEASURED on one attempt: it refused `workspace:5` with
 * `KILL_TIMEOUT`, the chair closed that workspace later, and health still read `down — The old
 * Claude session did not stop.` over twelve working seats, because nothing schedules an attempt over a
 * live fleet. Repro: `grep <attempt-id> "$SLOPWEAVER_HOME/fleet/resume.jsonl"` beside `slopweaver cmux list`.
 *
 * Health runs outside cmux and cannot list workspaces (`./journal.ts` says why), so it cannot see the absence
 * itself. `session close-done` runs inside cmux and already lists them; it journals a `seat-gone` line per seat
 * this returns, the fold drops the seat, and the verdict clears on the next read.
 *
 * ## A ref is only comparable inside one run of the cmux app
 *
 * cmux renumbers every ref when the app restarts (`../cmux/client.ts`), so after a restart `workspace:5` may be
 * absent while the seat lives on under another ref. Nothing is judged gone unless the running app provably started
 * before the attempt did, at `ps`'s one-second precision, and the same app was running on both sides of the
 * listing (`appStartAcross`); an unknown, ambiguous or changed app judges nothing gone.
 *
 * ## An absent workspace is not a dead session
 *
 * `KILL_TIMEOUT` is a `claude` that outlived SIGTERM, and nothing proves closing its tab ends it. A refused seat line
 * carries no session id (that attempt's `workspace:5` does not), so the seat's own session cannot be looked up; instead
 * nothing is judged gone while ANY live Claude session that started by the attempt's finish runs outside every cmux
 * surface — that is where such an orphan would be. A session started after the finish cannot be one. "Live Claude
 * session" is the session registry's live records AND every `claude` process one `ps` listing names, taken after the
 * registry scan: the registry alone misses a process whose file is gone, and a process the scan
 * missed by starting during it started after the finish. MEASURED: all 9 live registry pids sat inside a
 * surface tree, so a healthy fleet pays nothing. One gap, stated rather than discovered: a Claude Code process whose
 * executable is not named `claude` (an npm install runs as `node`) AND whose live record is not in the registry this
 * verb scans — its file gone, or kept under another `CLAUDE_CONFIG_DIR` — is seen by neither. Every
 * live one on this machine is the native binary:
 * `TZ=UTC LC_ALL=C ps -ax -o pid=,lstart=,comm= | grep '/claude$'`.
 *
 * Every input fails closed the same way — an inventory not read at one instant, a journal line that would not decode
 * inside the newest attempt, an attempt still running, a session registry that will not read — because the two
 * failure directions are not equal: a seat wrongly kept reads red until the next attempt, which is the behaviour
 * before this; a seat wrongly dropped hides a live one.
 *
 * Pure: events and readings in, the lines to append out. The append is `../cli/commands/session/closeDone.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { lstartMs } from "#lib/lstart.js";

import type { PsRow } from "../cmux/appProcess.js";
import { type FleetJournalEvent, type FleetJournalRead, foldNewestAttempt, newestAttemptReadWhole } from "./journal.js";

/** One `seat-gone` line, as appended. */
export type SeatGoneEvent = Extract<FleetJournalEvent, { kind: "seat-gone" }>;

/** One reading of the running cmux app off the process table. */
export interface CmuxAppReading {
  readonly pid: number;
  readonly startedMs: number;
}

/**
 * The app's start, when the SAME app was running on both sides of the inventory read — so the refs it returned are
 * that app's. A restart between a single reading and the listing would hand a renumbered inventory a stale start,
 * and a live seat would read as gone; two equal readings bracket the listing and close that.
 *
 * @param before the reading taken before the strict listing
 * @param after the reading taken after it
 * @returns the start, or `undefined` when either reading is missing or they name different processes
 */
export function appStartAcross({
  before,
  after,
}: {
  before: CmuxAppReading | undefined;
  after: CmuxAppReading | undefined;
}): number | undefined {
  if (before === undefined || after === undefined) {
    return undefined;
  }
  return before.pid === after.pid && before.startedMs === after.startedMs ? before.startedMs : undefined;
}

/** One live Claude session, by its pid and the start `ps` printed for it. */
export interface LiveSessionStart {
  readonly pid: number;
  /** The process start, or `undefined` when it would not convert — such a session could be anyone's. */
  readonly startedIso: string | undefined;
}

/** The executable Claude Code installs as, by `ps -o comm=`'s last path segment (`~/.local/bin/claude`). */
const CLAUDE_EXECUTABLE = "claude";

/**
 * Every `claude` process in one `ps` listing, by its own start — the witness that does not lean on the session
 * registry. A process whose registry file is gone, or not yet written, is still a running `claude` the listing names.
 * A start that is not a real instant is unknown, which blocks like any other unknown start.
 *
 * @param rows one whole `ps -ax -o pid=,ppid=,lstart=,comm=` listing
 * @returns each `claude` process's pid and start
 */
export function claudeProcessesOf({ rows }: { rows: readonly PsRow[] }): readonly LiveSessionStart[] {
  return rows
    .filter((row) => row.command.split("/").at(-1) === CLAUDE_EXECUTABLE)
    .map((row) => {
      const startedMs = lstartMs({ text: row.start });
      return { pid: row.pid, startedIso: startedMs === undefined ? undefined : new Date(startedMs).toISOString() };
    });
}

/**
 * The live sessions no cmux surface holds.
 *
 * @param live every live Claude session the registry names
 * @param surfacePids every pid one `system.top` reply put under a surface
 * @returns the sessions running outside cmux
 */
export function sessionsOutsideCmux({
  live,
  surfacePids,
}: {
  live: readonly LiveSessionStart[];
  surfacePids: readonly number[];
}): readonly LiveSessionStart[] {
  const inside = new Set(surfacePids);
  return live.filter((session) => !inside.has(session.pid));
}

/** `ps` prints a process start to the whole second, so the app's true start is anywhere in the second after it. */
const PS_START_PRECISION_MS = 1000;

/**
 * Whether a session outside cmux could be a seat the attempt left running: one whose start is unknown, or not
 * provably after the attempt's finish. `ps`'s whole-second stamp floors the true start, so a stamp at or before the
 * finish could be either side of it.
 */
function couldBeOrphanOf({
  outsideCmux,
  finishedIso,
}: {
  outsideCmux: readonly LiveSessionStart[];
  finishedIso: string | undefined;
}): boolean {
  if (outsideCmux.length === 0) {
    return false;
  }
  const finishedMs = finishedIso === undefined ? undefined : parseStrictIsoInstantMs({ text: finishedIso });
  if (finishedMs === undefined) {
    return true;
  }
  return outsideCmux.some((session) => {
    const startedMs =
      session.startedIso === undefined ? undefined : parseStrictIsoInstantMs({ text: session.startedIso });
    return startedMs === undefined || startedMs <= finishedMs;
  });
}

/** The newest `attempt-finished` line's instant for one attempt, or `undefined` when none is journalled. */
function finishedAtIso({ journal, attemptId }: { journal: FleetJournalRead; attemptId: string }): string | undefined {
  const line = journal.events.findLast((event) => event.kind === "attempt-finished" && event.attemptId === attemptId);
  return line?.atIso;
}

/**
 * Whether the running app provably started before the attempt did — so the refs the attempt journalled are the
 * refs the live inventory uses. An unknown app start, or an attempt start that names no real instant (`Date.parse`
 * would roll `02-31` into March), proves nothing.
 */
function sameRefGeneration({
  appStartedMs,
  attemptStartedIso,
}: {
  appStartedMs: number | undefined;
  attemptStartedIso: string;
}): boolean {
  const attemptStartedMs = parseStrictIsoInstantMs({ text: attemptStartedIso });
  if (appStartedMs === undefined || attemptStartedMs === undefined) {
    return false;
  }
  return appStartedMs + PS_START_PRECISION_MS <= attemptStartedMs;
}

/**
 * The `seat-gone` lines one sweep should append: one per worker seat the newest FINISHED attempt left anything but
 * reseated, whose ref the live inventory does not carry, and which no earlier line already named — the fold has
 * already dropped those.
 *
 * @param journal the fleet journal as read — a line from the newest attempt on that would not decode judges nothing
 *   gone, since the seat it held, or a newer attempt's start, is exactly what the fold would be missing
 * @param liveRefs every workspace ref one whole `system.top` reply held this sweep (`../cmux/topology.ts`)
 * @param outsideCmux the live Claude sessions no surface in that same reply holds
 * @param appStartedMs when the running cmux app started, or `undefined` when it could not be read unambiguously
 * @param nowIso the instant the lines carry
 * @returns the lines, none when the attempt is unfinished, partly unreadable, not provably inside this app run, or
 *   when a session outside cmux could be one it left running
 */
export function goneSeatEvents({
  journal,
  liveRefs,
  outsideCmux,
  appStartedMs,
  nowIso,
}: {
  journal: FleetJournalRead;
  liveRefs: ReadonlySet<string>;
  outsideCmux: readonly LiveSessionStart[];
  appStartedMs: number | undefined;
  nowIso: string;
}): readonly SeatGoneEvent[] {
  if (!newestAttemptReadWhole({ journal })) {
    return [];
  }
  const attempt = foldNewestAttempt({ events: journal.events });
  if (attempt?.finished === undefined) {
    return [];
  }
  if (!sameRefGeneration({ appStartedMs, attemptStartedIso: attempt.startedAtIso })) {
    return [];
  }
  if (couldBeOrphanOf({ finishedIso: finishedAtIso({ attemptId: attempt.attemptId, journal }), outsideCmux })) {
    return [];
  }
  const lines: SeatGoneEvent[] = [];
  for (const phase of attempt.seats.values()) {
    if (phase.role !== "worker" || phase.phase === "reseated" || liveRefs.has(phase.workspaceRef)) {
      continue;
    }
    lines.push({
      atIso: nowIso,
      attemptId: attempt.attemptId,
      kind: "seat-gone",
      schemaVersion: 1,
      workspaceRef: phase.workspaceRef,
    });
  }
  return lines;
}
