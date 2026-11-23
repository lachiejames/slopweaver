/**
 * `session close-done`'s fleet half: journal each seat the newest recovery attempt refused whose workspace is gone,
 * then close the finished `fleet resume` tabs — both under `fleet resume`'s own recovery lock. The judgement is pure
 * (`../../../fleet/goneSeats.ts`); this file reads the journal, the cmux app, one `system.top` reply and the Claude
 * session registry, and appends.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { psStartMs, soleCmuxAppOf } from "../../../cmux/appProcess.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { listProcessesStrict } from "../../../cmux/reviveEffects.js";
import {
  appStartAcross,
  type CmuxAppReading,
  claudeProcessesOf,
  goneSeatEvents,
  type LiveSessionStart,
  type SeatGoneEvent,
  sessionsOutsideCmux,
} from "../../../fleet/goneSeats.js";
import type { FleetJournalRead } from "../../../fleet/journal.js";
import { liveSeatsFromScan } from "../../../fleet/liveSeat.js";
import { acquireFleetLock } from "../../../fleet/locks.js";
import type { FleetPort } from "../../../fleet/port.js";
import { readProcessStarts } from "../../../fleet/processStarts.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import { scanSessions } from "../../../sessions/liveSessionStore.js";
import { lstartToIso } from "../../../sessions/parkSeat.js";
import type { SessionItem } from "../../../sessions/session.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { type CloseDoneShellOutcome, sweepFinishedResumeShells } from "./closeDoneShells.js";

/**
 * The fleet recovery journal, for whether a later attempt superseded a resume tab's and which refused seats are
 * gone. One that will not read is said so and read as empty: a healthy tab still closes on its own line, every other
 * one is held, and no seat is found gone. A line that will not decode is said so and kept as a position, since
 * inside the newest attempt it stops both judgements (`newestAttemptReadWhole`).
 *
 * @param fleet where the journal is read
 * @param home the state home holding the journal
 * @returns the decoded events, oldest first, and where any line failed
 */
async function fleetJournal({ fleet, home }: { fleet: FleetPort; home: string }): Promise<FleetJournalRead> {
  const read = await fleet.readResumeJournal({ home });
  if (read.isErr()) {
    logger.error({ msg: `session close-done: the fleet journal could not be read — ${read.error.message}` });
    return { events: [], unreadable: 0, unreadableAt: [] };
  }
  if (read.value.unreadable > 0) {
    logger.error({
      msg: `session close-done: ${String(read.value.unreadable)} line(s) of the fleet journal could not be read`,
    });
  }
  return read.value;
}

/**
 * The running cmux app, off one `ps` listing read WHOLE — `undefined`, said so, when that cannot be read or more than
 * one app runs, since then which one's refs the sweep listed is unknown. A skipped row could be a second app, the one
 * the socket reached.
 *
 * @returns its pid and start, or `undefined` when the listing, the one app or its start stamp could not be read
 */
export function runningCmuxApp(): CmuxAppReading | undefined {
  const rows = listProcessesStrict();
  if (rows.isErr()) {
    logger.error({ msg: `session close-done: the process table could not be read whole — ${rows.error}` });
    return undefined;
  }
  const app = soleCmuxAppOf({ rows: rows.value });
  if (app === undefined) {
    return undefined;
  }
  const startedMs = psStartMs({ start: app.start });
  return startedMs === undefined ? undefined : { pid: app.pid, startedMs };
}

/**
 * Every live Claude session, with its process start: the registry's live records, and every `claude` process one
 * `ps` listing taken AFTER the registry scan names (`claudeProcessesOf`) — so a process whose registry file is gone
 * is still seen, and one the scan missed by starting during it is in the listing. Fails closed, as
 * `liveSeatsFromScan` does, on a registry file or a process table it cannot read, since the session it missed could
 * be an orphan.
 *
 * @returns each live session's pid and start, or why the registry or the process table cannot say
 */
export function liveClaudeSessions(): Result<readonly LiveSessionStart[], string> {
  const read = readProcessStarts();
  if ("why" in read) {
    return err(read.why);
  }
  const scan = scanSessions({ sessionsDir: join(claudeHomeDir(), "sessions") });
  const registry = liveSeatsFromScan({ scan, starts: read.starts });
  if (registry.isErr()) {
    return err(registry.error);
  }
  const rows = listProcessesStrict();
  if (rows.isErr()) {
    return err(`the process table could not be read whole — ${rows.error}`);
  }
  const registered = registry.value.map((record) => ({
    pid: record.pid,
    startedIso: record.procStart === undefined ? undefined : lstartToIso({ text: record.procStart }),
  }));
  return ok([...registered, ...claudeProcessesOf({ rows: rows.value })]);
}

/** What the fleet half reads besides the journal: the app, and the live sessions. */
export interface FleetSweepReads {
  /** The running cmux app, or `undefined` when it cannot be read unambiguously. */
  readonly readApp: () => CmuxAppReading | undefined;
  /** Every live Claude session, or why the registry cannot say. */
  readonly readLiveSessions: () => Result<readonly LiveSessionStart[], string>;
}

/**
 * Journal a `seat-gone` line for each seat the newest finished attempt refused whose workspace one whole `system.top`
 * reply no longer holds (`../../../fleet/goneSeats.ts`), then sweep the finished resume tabs over the journal as it
 * now reads — so a tab is released on the same fact `fleet health` will read. The app is read on both sides of that
 * reply, judging nothing when a restart fell between, and the live sessions after it, judging nothing while one
 * outside cmux could be a seat the attempt left running.
 *
 * The read, the inventory, the appends AND the tab sweep run under `fleet resume`'s own recovery lock, which a pass
 * holds from before its `attempt-started` line to its end — so no attempt can start, or still be running, between the
 * judgement, the journal re-read and a tab's close. A pass holding it means this judges no seat gone and closes no tab
 * this sweep; the next sweep does both. A dry run journals nothing, and reports the lines it would write and the tabs
 * they would release; a line the journal will not take is said so and left out, keeping that seat red and its tab
 * held.
 *
 * @param client the sweep's one cmux client, for the topology read and the closes
 * @param dryRun report the lines and closes, writing and closing nothing
 * @param fleet where the recovery journal is read and appended
 * @param home the state home holding the journal
 * @param nowIso the instant the lines carry
 * @param ownWorkspaceId the caller's own workspace, never closed
 * @param reads the app and live-session reads
 * @param rows the folded session ledger
 * @param workspaces the inventory the sweep listed
 * @returns the lines journalled (or, on a dry run, that would be) and one outcome per resume tab judged
 */
export async function sweepFleetUnderLock({
  client,
  dryRun,
  fleet,
  home,
  nowIso,
  ownWorkspaceId,
  reads,
  rows,
  workspaces,
}: {
  client: CmuxHostSurface;
  dryRun: boolean;
  fleet: FleetPort;
  home: string;
  nowIso: string;
  ownWorkspaceId: string | undefined;
  reads: FleetSweepReads;
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): Promise<{ readonly gone: readonly SeatGoneEvent[]; readonly shells: readonly CloseDoneShellOutcome[] }> {
  const locked = acquireFleetLock({ home, nowIso });
  if (locked.isErr()) {
    logger.error({
      msg: `session close-done: no seat is judged gone and no resume tab closed this sweep — ${locked.error.message}`,
    });
    return { gone: [], shells: [] };
  }
  try {
    const gone = await judgeUnderLock({ client, dryRun, fleet, home, nowIso, reads });
    const read = await fleetJournal({ fleet, home });
    const journal = dryRun ? { ...read, events: [...read.events, ...gone] } : read;
    const shells = await sweepFinishedResumeShells({ client, dryRun, journal, ownWorkspaceId, rows, workspaces });
    return { gone, shells };
  } finally {
    locked.value.release();
  }
}

/** `sweepFleetUnderLock`'s seat judgement, run while it holds the recovery lock: the lines it appended, or would. */
async function judgeUnderLock({
  client,
  dryRun,
  fleet,
  home,
  nowIso,
  reads,
}: {
  client: CmuxHostSurface;
  dryRun: boolean;
  fleet: FleetPort;
  home: string;
  nowIso: string;
  reads: FleetSweepReads;
}): Promise<readonly SeatGoneEvent[]> {
  const journal = await fleetJournal({ fleet, home });
  const before = reads.readApp();
  const topology = await client.topologyStrict();
  const appStartedMs = appStartAcross({ after: reads.readApp(), before });
  if (topology.isErr()) {
    logger.error({
      msg: `session close-done: no seat is judged gone — the cmux topology could not be read whole: ${topology.error.message}`,
    });
    return [];
  }
  const live = reads.readLiveSessions();
  if (live.isErr()) {
    logger.error({
      msg: `session close-done: no seat is judged gone — the live sessions could not be read: ${live.error}`,
    });
    return [];
  }
  const lines = goneSeatEvents({
    appStartedMs,
    journal,
    liveRefs: new Set(topology.value.workspaceRefs),
    nowIso,
    outsideCmux: sessionsOutsideCmux({ live: live.value, surfacePids: topology.value.surfacePids }),
  });
  const gone: SeatGoneEvent[] = [];
  for (const line of lines) {
    if (!dryRun) {
      const appended = await fleet.appendResumeEvent({ event: line, home });
      if (appended.isErr()) {
        logger.error({
          msg: `session close-done: ${line.workspaceRef} is gone, but the fleet journal would not take it — ${appended.error.message}`,
        });
        continue;
      }
    }
    gone.push(line);
  }
  return gone;
}

/**
 * One line for one seat found gone.
 *
 * @param gone the line journalled
 * @param dryRun whether the sweep only reported
 * @returns the line
 */
export function renderGoneSeat({ gone, dryRun }: { gone: SeatGoneEvent; dryRun: boolean }): string {
  return `${dryRun ? "would journal" : "journalled"} ${gone.workspaceRef} gone — fleet resume attempt ${gone.attemptId} refused a seat that no longer exists`;
}
