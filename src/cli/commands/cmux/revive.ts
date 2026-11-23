/**
 * `slopweaver cmux revive` — knock on cmux's control socket from OUTSIDE cmux, read a reply by what the seats' own
 * calls last heard (`../../../cmux/insideCalls.ts`), and when cmux has been hung for the bound while the app's pid
 * lives, quit and reopen the app. Never the owner's hand, even on a five-hour hang (the owner's standing
 * steers — always online, recovery, self-healing — already answer whether to ask them).
 *
 * The desktop app runs it every minute: it is started by Finder, so it is outside every cmux pty and survives the
 * restart, and its `fleet resume` launch then brings each seat back the way it does after any restore. Run inside
 * cmux it refuses, because it would be killed with the app it is restarting. What it decides is
 * `../../../cmux/hang.ts`; one reading is `./reviveProbe.ts`, and the process and socket effects are
 * `../../../cmux/reviveEffects.ts`, reached only through its `ReviveDeps` so a test drives the whole pass with fakes.
 */
import { logger } from "#lib/logger.js";

import {
  DEFAULT_HANG_BOUND_MS,
  judgeHang,
  MAX_READING_GAP_MS,
  MIN_HANG_BOUND_MS,
  newestReading,
  type ReviveAction,
  restartAllowance,
  reviveAction,
  shouldJournalReading,
} from "../../../cmux/hang.js";
import { hangNamingEvents } from "../../../cmux/hangNaming.js";
import { readInsideCallEvidence } from "../../../cmux/insideCalls.js";
import {
  cmuxSocketPath,
  knockOnSocket,
  listProcesses,
  PROBE_TIMEOUT_MS,
  restartCmuxApp,
} from "../../../cmux/reviveEffects.js";
import type { CmuxProbeState, CmuxReading } from "../../../cmux/reviveJournal.js";
import { slopweaverHome } from "../../../config.js";
import { acquireCmuxReviveLock } from "../../../fleet/locks.js";
import { fleetPort } from "../../../fleet/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { numberFlag, parseCmuxVerb, stringFlag } from "./core.js";
import { probeCmux, type ReviveDeps } from "./reviveProbe.js";
import { staleReadingExit } from "./reviveStale.js";

/** What one invocation asked for. */
export interface ReviveRequest {
  readonly boundMs: number;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/** What one invocation found and did, as its `--json` document. */
export interface ReviveReport {
  readonly state: CmuxProbeState;
  readonly appPid: number | null;
  readonly detail: string;
  readonly action: ReviveAction["kind"];
  readonly sinceIso?: string;
  readonly untilIso?: string;
  /** Why a held restart is held: the cooldown, the day's cap, or a recurring hang's loop. */
  readonly heldAs?: "cooldown" | "capped" | "recurring";
  readonly restart?: { readonly outcome: string; readonly newAppPid: number | null; readonly detail: string };
}

/** Parse the flags. */
function readRequest({ argv }: { argv: readonly string[] }): ReviveRequest | number {
  const parsed = parseCmuxVerb({ argv, verb: "revive" });
  if (typeof parsed === "number") {
    return parsed;
  }
  if (parsed.positionals.length > 0) {
    logger.error({ msg: `cmux revive: takes no positional argument (got ${parsed.positionals.join(" ")})` });
    return EXIT_USAGE;
  }
  const bound = numberFlag({ name: "bound-seconds", parsed });
  if ("error" in bound) {
    logger.error({ msg: `cmux revive: ${bound.error}` });
    return EXIT_USAGE;
  }
  let boundMs = DEFAULT_HANG_BOUND_MS;
  if (bound.value !== undefined) {
    boundMs = bound.value * 1000;
  }
  if (boundMs < MIN_HANG_BOUND_MS) {
    logger.error({ msg: `cmux revive: --bound-seconds must be at least ${String(MIN_HANG_BOUND_MS / 1000)}` });
    return EXIT_USAGE;
  }
  let home = slopweaverHome();
  const namedHome = stringFlag({ name: "home", parsed });
  if (namedHome !== undefined) {
    home = namedHome;
  }
  return { boundMs, dryRun: parsed.values["dry-run"] === true, home, json: parsed.values["json"] === true };
}

/**
 * The exit code a report reads as: 0 answering or brought back, 3 no app, 4 not yet (inside the bound, held, or
 * another revive restarting it), 1 a restart that failed.
 *
 * @param report what the pass found and did
 * @returns the exit code
 */
export function reviveExit({ report }: { report: ReviveReport }): number {
  if (report.restart !== undefined) {
    if (report.restart.outcome === "skipped") {
      return EXIT_DEFERRED;
    }
    return report.restart.outcome === "answering" ? EXIT_OK : EXIT_ERROR;
  }
  if (report.state === "absent") {
    return EXIT_EXPECTED_EMPTY;
  }
  return report.action === "none" ? EXIT_OK : EXIT_DEFERRED;
}

/** The report as one line. */
function reportLine({ report }: { report: ReviveReport }): string {
  const app = report.appPid === null ? "no cmux app running" : `cmux pid ${String(report.appPid)} ${report.state}`;
  const since = report.sinceIso === undefined ? "" : ` since ${report.sinceIso}`;
  const parts = [`cmux revive: ${app}${since} — ${report.detail}`];
  if (report.action === "wait") {
    parts.push("within the bound, so nothing restarted yet");
  } else if (report.action === "held" && report.heldAs === "recurring") {
    parts.push("it hung again after a restart for a recurring hang, so restarts are held while this hang lasts");
  } else if (report.action === "held") {
    parts.push(`past the bound but restarts are held until ${String(report.untilIso)}`);
  } else if (report.action === "restart" && report.restart === undefined) {
    parts.push("past the bound — would restart it (dry run)");
  }
  if (report.restart !== undefined) {
    parts.push(`restart ${report.restart.outcome}: ${report.restart.detail}`);
  }
  return parts.join("; ");
}

/**
 * Restart under the lock, re-judging inside it so a second caller never restarts an app the first one already did.
 *
 * @returns the restart's end, or the reason it did not run
 */
async function restartLocked({
  request,
  deps,
  appPid,
  sinceIso,
}: {
  request: ReviveRequest;
  deps: ReviveDeps;
  appPid: number;
  sinceIso: string;
}): Promise<NonNullable<ReviveReport["restart"]>> {
  const lock = acquireCmuxReviveLock({ home: request.home, nowIso: deps.nowIso() });
  if (lock.isErr()) {
    return { detail: lock.error.message, newAppPid: null, outcome: "skipped" };
  }
  try {
    const journal = await deps.fleet.readCmuxReviveJournal({ home: request.home });
    if (journal.isErr()) {
      return { detail: journal.error.message, newAppPid: null, outcome: "skipped" };
    }
    // The whole decision again, on the journal as it stands under the lock: a stale verdict never restarts.
    const nowIso = deps.nowIso();
    const events = journal.value.events;
    const hang = judgeHang({ boundMs: request.boundMs, events, maxGapMs: MAX_READING_GAP_MS, nowIso });
    const again = reviveAction({ allowance: restartAllowance({ events, hang, nowIso }), hang });
    if (again.kind !== "restart" || again.appPid !== appPid) {
      return { detail: "another revive restarted cmux first, or the hang ended", newAppPid: null, outcome: "skipped" };
    }
    const started = await deps.fleet.appendCmuxReviveEvent({
      event: { appPid, atIso: nowIso, hungSinceIso: sinceIso, kind: "restart-started", schemaVersion: 1 },
      home: request.home,
    });
    if (started.isErr()) {
      // A restart the journal cannot record would never count against the cooldown: refuse it rather than loop.
      return { detail: started.error.message, newAppPid: null, outcome: "failed" };
    }
    const end = await deps.restart({ appPid });
    const finished = await deps.fleet.appendCmuxReviveEvent({
      event: { ...end, atIso: deps.nowIso(), kind: "restart-finished", schemaVersion: 1 },
      home: request.home,
    });
    if (finished.isErr()) {
      // The restart ran; only its record is missing, and recurrence then reads the restart as still in flight.
      return { ...end, detail: `${end.detail}; its finish was not journalled: ${finished.error.message}` };
    }
    return end;
  } finally {
    lock.value.release();
  }
}

/**
 * Name the open hang in the journal — a recurrence once, a held restart's marker kept inside the tail. Deliberately WITHOUT the
 * revive lock: that lock never goes stale, so a revive paused while holding it would starve the marker until the
 * tail forgot the loop. The journal is append-only and its readers dedupe, so two revives
 * racing here cost one duplicate line at most.
 *
 * What this does NOT close: the marker is restated only once a quarter of the row tail follows it, so the other three
 * quarters appended between one revive's read and its naming append — some 3,000 revives, all paused at this exact
 * point — could push the marker out of the tail and let a later revive restart. The desktop app runs one revive a
 * minute, so the fleet never builds that; closing it would take the hold on its own row outside the tail.
 */
async function journalHangNaming({
  request,
  deps,
  hungSinceIso,
  nowIso,
}: {
  request: ReviveRequest;
  deps: ReviveDeps;
  hungSinceIso: string;
  nowIso: string;
}): Promise<void> {
  const journal = await deps.fleet.readCmuxReviveJournal({ home: request.home });
  if (journal.isErr()) {
    logger.error({ msg: `cmux revive: the hang was not named: ${journal.error.message}` });
    return;
  }
  for (const event of hangNamingEvents({ events: journal.value.events, hungSinceIso, nowIso })) {
    const appended = await deps.fleet.appendCmuxReviveEvent({ event, home: request.home });
    if (appended.isErr()) {
      logger.error({ msg: `cmux revive: the ${event.kind} line was not journalled: ${appended.error.message}` });
    }
  }
}

/**
 * Journal the reading and judge it: the report before any restart, or the exit code that ends the pass. A reading
 * already stale is dropped unjournalled and unjudged, so a paused revive never appends cmux's state from before a hang
 * behind it — which would split one hang into two runs, the second past the hour that holds a loop's third restart.
 * Stale either way: a clock set back while the revive was paused stamps that reading in the
 * FUTURE, and it would release a held marker. And stale whatever its stamp says once anything
 * was journalled after the probe began: a clock set back by less than the minute leaves a reading taken before a hang
 * stamped AFTER the hang's first line, and the journal's newest sequence is the one order no clock can move.
 *
 * What this does NOT close: a revive suspended between those checks and its own append still appends what it read.
 * That alone is one reading out of order; it becomes a third restart only with a clock set back as well, and a hang
 * held long enough for its restart lines to leave the row tail, so a later answer stamped past the held one releases
 * the marker. Closing it needs the check and the append to be one step against every other
 * writer: a lock every journal append waits on, which a paused holder would turn into a fleet-wide stall of the
 * journal itself (the reason `journalHangNaming` takes none).
 */
async function judge({
  request,
  deps,
  reading,
  sequenceBeforeProbe,
}: {
  request: ReviveRequest;
  deps: ReviveDeps;
  reading: CmuxReading;
  sequenceBeforeProbe: number;
}): Promise<
  | {
      report: ReviveReport;
      action: ReviveAction;
    }
  | number
> {
  const journal = await deps.fleet.readCmuxReviveJournal({ home: request.home });
  if (journal.isErr()) {
    logger.error({ msg: `cmux revive: ${journal.error.message}` });
    return EXIT_ERROR;
  }
  const stale = await staleReadingExit({
    clock: deps.nowIso,
    fleet: deps.fleet,
    home: request.home,
    reading,
    sequenceBeforeProbe,
  });
  if (stale !== undefined) {
    return stale;
  }
  const previous = newestReading({ events: journal.value.events });
  if (!request.dryRun && shouldJournalReading({ next: reading, previous })) {
    const appended = await deps.fleet.appendCmuxReviveEvent({ event: reading, home: request.home });
    if (appended.isErr()) {
      logger.error({ msg: `cmux revive: ${appended.error.message}` });
      return EXIT_ERROR;
    }
  }
  const events = [...journal.value.events, reading];
  const nowIso = reading.atIso;
  const hang = judgeHang({ boundMs: request.boundMs, events, maxGapMs: MAX_READING_GAP_MS, nowIso });
  if (!request.dryRun && hang.kind === "unresponsive") {
    await journalHangNaming({ deps, hungSinceIso: hang.sinceIso, nowIso, request });
  }
  const action = reviveAction({ allowance: restartAllowance({ events, hang, nowIso }), hang });
  return { action, report: reportOf({ action, reading }) };
}

/** What one pass prints about the reading and the action it chose. */
function reportOf({ action, reading }: { action: ReviveAction; reading: CmuxReading }): ReviveReport {
  let report: ReviveReport = {
    action: action.kind,
    appPid: reading.appPid,
    detail: reading.detail,
    state: reading.state,
  };
  if (action.kind !== "none") {
    report = { ...report, sinceIso: action.sinceIso };
  }
  if (action.kind === "held") {
    report = { ...report, heldAs: action.allowance.kind };
  }
  if (action.kind === "held" && action.allowance.kind !== "recurring") {
    report = { ...report, untilIso: action.allowance.untilIso };
  }
  return report;
}

/**
 * One pass: probe, journal, and restart a hang past its bound unless this is a dry run.
 *
 * @param request what the invocation asked for
 * @param deps every effect the pass reaches
 * @returns what it found and did, or the exit code of a pass that could not judge
 */
export async function revivePass({
  request,
  deps,
}: {
  request: ReviveRequest;
  deps: ReviveDeps;
}): Promise<ReviveReport | number> {
  const sequenceBeforeProbe = await deps.fleet.newestCmuxReviveSequence({ home: request.home });
  if (sequenceBeforeProbe.isErr()) {
    logger.error({ msg: `cmux revive: ${sequenceBeforeProbe.error.message}` });
    return EXIT_ERROR;
  }
  const reading = await probeCmux({ deps, home: request.home });
  if (typeof reading === "number") {
    return reading;
  }
  const judged = await judge({ deps, reading, request, sequenceBeforeProbe: sequenceBeforeProbe.value });
  if (typeof judged === "number") {
    return judged;
  }
  const { action, report } = judged;
  if (action.kind !== "restart" || request.dryRun) {
    return report;
  }
  const restart = await restartLocked({ appPid: action.appPid, deps, request, sinceIso: action.sinceIso });
  return { ...report, restart };
}

/** The effects a real invocation reaches. */
function productionDeps(): ReviveDeps {
  return {
    fleet: fleetPort(),
    insideCmuxEnv: process.env["CMUX_WORKSPACE_ID"] !== undefined,
    knock: () => knockOnSocket({ socketPath: cmuxSocketPath(), timeoutMs: PROBE_TIMEOUT_MS }),
    listProcesses,
    nowIso: () => new Date().toISOString(),
    pid: process.pid,
    readInsideCalls: readInsideCallEvidence,
    restart: restartCmuxApp,
  };
}

/**
 * `cmux revive` — probe, journal, and restart a hang past its bound.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxRevive(argv: readonly string[]): Promise<number> {
  const request = readRequest({ argv });
  if (typeof request === "number") {
    return request;
  }
  const report = await revivePass({ deps: productionDeps(), request });
  if (typeof report === "number") {
    return report;
  }
  logger.out({ line: request.json ? JSON.stringify(report) : reportLine({ report }) });
  return reviveExit({ report });
}

export const cmuxReviveCommand = defineCommand({ run: runCmuxRevive });
