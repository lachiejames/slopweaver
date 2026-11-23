/**
 * One `cmux revive` reading: find the app, refuse inside cmux, knock from outside, and — when the knock is answered,
 * which proves only cmux's access layer alive — read what the seats' own calls last heard of this app. The verb
 * that journals and judges the reading is `./revive.ts`.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { cmuxAppOf, descendsFrom, type PsRow, psStartMs } from "../../../cmux/appProcess.js";
import { classifyProbe, MAX_READING_GAP_MS } from "../../../cmux/hang.js";
import type { InsideCallEvidence, InsideCallRead } from "../../../cmux/insideCalls.js";
import type { RestartEnd, SocketKnock } from "../../../cmux/reviveEffects.js";
import type { CmuxReading } from "../../../cmux/reviveJournal.js";
import type { FleetError } from "../../../fleet/errors.js";
import type { FleetPort } from "../../../fleet/port.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** The longest `detail` a reading carries; a knock's or a seat's note is a line, so this cuts only a runaway one. */
const READING_DETAIL_MAX_CHARS = 512;

/** Every effect one pass reaches: the process table, the socket, the restart, where it runs, and the clock. */
export interface ReviveDeps {
  readonly listProcesses: () => Result<readonly PsRow[], string>;
  readonly knock: () => Promise<SocketKnock>;
  readonly restart: (options: { readonly appPid: number }) => Promise<RestartEnd>;
  /** What the seats' calls last heard of the app started at `appStartedMs` (`../../../cmux/insideCalls.ts`). */
  readonly readInsideCalls: (options: {
    readonly home: string;
    readonly appStartedMs: number;
    readonly nowMs: number;
  }) => Result<InsideCallRead, FleetError>;
  /** Whether cmux's own environment marks this process as one of its seats. */
  readonly insideCmuxEnv: boolean;
  readonly pid: number;
  readonly nowIso: () => string;
  /** The revive journal's rows, read and appended through the store. */
  readonly fleet: FleetPort;
}

/** What the seats last heard, and the clause the reading's detail carries about it. */
interface Heard {
  readonly inside: InsideCallEvidence | undefined;
  readonly answeredIso: string | undefined;
  readonly note: string;
}

/**
 * What the seats' calls last heard of this app, read only once the knock replied: the evidence, or the exit code
 * that ends the pass. A stamp file that would not decode leaves nothing to judge by, and says so in the detail.
 */
function insideOf({
  home,
  deps,
  app,
  nowIso,
}: {
  home: string;
  deps: ReviveDeps;
  app: PsRow;
  nowIso: string;
}): Heard | number {
  const appStartedMs = psStartMs({ start: app.start });
  if (appStartedMs === undefined) {
    logger.error({ msg: `cmux revive: cmux pid ${String(app.pid)}'s start "${app.start}" is not a ps lstart stamp` });
    return EXIT_ERROR;
  }
  // `ps lstart` is to the second, so judge from the end of that second: the previous app's last call can share it.
  const read = deps.readInsideCalls({ appStartedMs: appStartedMs + 1000, home, nowMs: Date.parse(nowIso) });
  if (read.isErr()) {
    logger.error({ msg: `cmux revive: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const { answeredIso, evidence, unreadable } = read.value;
  if (unreadable > 0) {
    const note = `; ${String(unreadable)} inside-call stamp(s) would not decode`;
    return { answeredIso: undefined, inside: undefined, note };
  }
  if (evidence === undefined) {
    return { answeredIso: undefined, inside: undefined, note: "; no call inside cmux since it started" };
  }
  let note = `; the last call inside cmux was ${evidence.outcome} at ${evidence.atIso}`;
  if (evidence.outcome === "unanswered" && answeredIso !== undefined) {
    note = `${note}, the last answered at ${answeredIso}`;
  }
  return { answeredIso, inside: evidence, note };
}

/** Refuse inside cmux, naming what was read: the exit code, or `undefined` to go on. */
function refuseInside({ deps, underApp }: { deps: ReviveDeps; underApp: boolean }): number | undefined {
  if (!deps.insideCmuxEnv && !underApp) {
    return undefined;
  }
  // An app reopened from a seat once handed every run CMUX_WORKSPACE_ID, and the menu bar showed only the refusal.
  const read = underApp ? "this process descends from the cmux app" : "CMUX_WORKSPACE_ID is set in its environment";
  logger.error({
    msg: `cmux revive: refusing to run inside cmux (${read}) — a restart would kill this process with the app. The desktop app runs it from outside every minute.`,
  });
  return EXIT_ERROR;
}

/**
 * Find the app, refuse inside cmux, and knock: the reading, or the exit code that ends the pass.
 *
 * @param home the state home the seats stamp their calls in
 * @param deps every effect the pass reaches
 * @returns the reading, or the exit code
 */
export async function probeCmux({ home, deps }: { home: string; deps: ReviveDeps }): Promise<CmuxReading | number> {
  const rows = deps.listProcesses();
  if (rows.isErr()) {
    logger.error({ msg: `cmux revive: could not list processes — ${rows.error}` });
    return EXIT_ERROR;
  }
  const app = cmuxAppOf({ rows: rows.value });
  const underApp = app !== undefined && descendsFrom({ ancestorPid: app.pid, pid: deps.pid, rows: rows.value });
  const refused = refuseInside({ deps, underApp });
  if (refused !== undefined) {
    return refused;
  }
  if (app === undefined) {
    const absent = { appPid: null, appStart: null, detail: "no cmux app process", state: "absent" } as const;
    return { ...absent, atIso: deps.nowIso(), kind: "reading", schemaVersion: 1 };
  }
  // Stamped BEFORE the knock, so a revive paused across it carries a stamp that falls behind the clock and is
  // dropped (`./reviveStale.ts`), never one dated on resumption that reads the hang as begun minutes late. The seats' calls and the gap are still judged from the knock's own end.
  const atIso = deps.nowIso();
  const knock = await deps.knock();
  const heardIso = deps.nowIso();
  let heard: Heard = { answeredIso: undefined, inside: undefined, note: "" };
  if (knock.replied) {
    const read = insideOf({ app, deps, home, nowIso: heardIso });
    if (typeof read === "number") {
      return read;
    }
    heard = read;
  }
  const state = classifyProbe({
    answeredIso: heard.answeredIso,
    appRunning: true,
    connectRefused: knock.connectRefused,
    inside: heard.inside,
    maxGapMs: MAX_READING_GAP_MS,
    nowIso: heardIso,
    replied: knock.replied,
  });
  // Bounded, so one runaway note cannot swell the journal's rows: every other field of every
  // event is fixed-size or a stamp.
  const detail = `${knock.detail}${heard.note}`.slice(0, READING_DETAIL_MAX_CHARS);
  const reading = { appPid: app.pid, appStart: app.start, atIso, detail };
  return { ...reading, kind: "reading", schemaVersion: 1, state };
}
