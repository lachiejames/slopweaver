/**
 * Whether cmux is hung, judged from outside it, and whether the fleet may restart it now.
 *
 * MEASURED: cmux 0.64.22 hung with its main thread inside a SwiftUI view-graph
 * update, and its control socket refused every connect with ECONNREFUSED for five hours while the
 * app's pid lived at 11 MB resident (`supervisor-scratch/handoff-<n>/tick-46/close-done.err`). A refused or silent
 * socket while its pid lives is that hang. Quitting it and reopening it brought it back in seconds (the one-time
 * runner beside that file: TERM honoured inside 10s, `open -a cmux`, a new pid).
 *
 * A reply is NOT proof of life. MEASURED: that same app's handlers hung while its access layer
 * kept answering the outside knock with `ERROR: Access denied - only processes started inside cmux can connect` —
 * the only reply an outside process can get. So when the knock is answered, the verdict is what the seats' own calls
 * last heard (`./insideCalls.ts`): an answer, a timeout recent enough to be the hang still being felt, or nothing.
 *
 * Restarting cmux ends every seat's running turn — cmux restores each workspace and re-runs `claude --resume` in it
 * (`skills/supervisor/reference/reboot.md`) — so a hang must be HELD for the bound, without a gap, before the fleet
 * acts, and the fleet restarts at most once per cooldown and a few times a day: an app that hangs again straight
 * after a restart is a defect to investigate, never a loop to keep pressing. A hang back within the hour of a
 * restart is named and the third held (`./recurrence.ts`); a declined dialog ends the run (`./dialogRecovery.ts`).
 *
 * Pure: readings in, verdicts out. The probe and the restart are `./reviveEffects.ts`.
 */
import type { InsideCallEvidence } from "./insideCalls.js";
import { type CmuxFleetRecurrence, fleetRecurrence, recurringHoldOrigin } from "./recurrence.js";
import type { CmuxProbeState, CmuxReading, CmuxReviveEvent } from "./reviveJournal.js";

/** How long the socket must stay unanswered before the fleet restarts cmux: one turn lost per seat is the price. */
export const DEFAULT_HANG_BOUND_MS = 10 * 60_000;

/** The shortest bound a caller may set: below a minute, a paged-out app catching up reads as a hang. */
export const MIN_HANG_BOUND_MS = 60_000;

/** The widest gap between two readings that still counts as one watched hang; the desktop probes every minute. */
export const MAX_READING_GAP_MS = 5 * 60_000;

/** After a restart, how long before another may run. */
const RESTART_COOLDOWN_MS = 30 * 60_000;

/** How many restarts a day before the fleet stops restarting and leaves cmux for investigation. */
const RESTART_DAILY_CAP = 3;

const DAY_MS = 24 * 60 * 60_000;

/**
 * One probe's state from what the socket did and, when it replied, what the seats' calls last heard.
 *
 * @param appRunning whether a cmux app process exists
 * @param replied whether any byte came back — cmux's own access refusal counts
 * @param connectRefused whether the connect itself failed (ECONNREFUSED, ENOENT, …)
 * @param inside the newest call inside cmux since this app started, when there is one
 * @param answeredIso when a call inside cmux was last answered, even if a timeout came after it
 * @param nowIso the instant judged
 * @param maxGapMs how recent a timeout must be to say the hang is still being felt, and how long an answer breaks it
 * @returns the state to journal
 */
export function classifyProbe({
  appRunning,
  replied,
  connectRefused,
  inside,
  answeredIso,
  nowIso,
  maxGapMs,
}: {
  appRunning: boolean;
  replied: boolean;
  connectRefused: boolean;
  inside: InsideCallEvidence | undefined;
  answeredIso: string | undefined;
  nowIso: string;
  maxGapMs: number;
}): CmuxProbeState {
  if (!appRunning) {
    return "absent";
  }
  if (!replied) {
    return connectRefused ? "refused" : "silent";
  }
  if (inside === undefined) {
    return "unprobed";
  }
  if (inside.outcome === "answered") {
    return "answering";
  }
  const nowMs = Date.parse(nowIso);
  // Two readings of one run are at most the gap apart, so an answer between them is inside the gap of the later one.
  if (answeredIso !== undefined && nowMs - Date.parse(answeredIso) <= maxGapMs) {
    return "answering";
  }
  const ageMs = nowMs - Date.parse(inside.atIso);
  return ageMs >= 0 && ageMs <= maxGapMs ? "stalled" : "unprobed";
}

/**
 * Whether a state is the hang's — the app is there and nothing it was asked is answered. The three are one run on
 * purpose: one app whose socket refused and then let the knock in while the seats still timed out answered nothing
 * the whole span, and a reopened app is a new pid and start, which breaks the run on its own.
 */
function isUnanswered({ state }: { state: CmuxProbeState }): boolean {
  return state === "refused" || state === "silent" || state === "stalled";
}

/**
 * Whether a fresh reading belongs in the journal: every one while unanswered, so a hang's span is watched, and
 * otherwise only a change.
 *
 * @param previous the newest journalled reading
 * @param next the reading just taken
 * @returns whether to append it
 */
export function shouldJournalReading({
  previous,
  next,
}: {
  previous: CmuxReading | undefined;
  next: Pick<CmuxReading, "appPid" | "appStart" | "state">;
}): boolean {
  if (previous === undefined || isUnanswered({ state: next.state })) {
    return true;
  }
  return previous.state !== next.state || previous.appPid !== next.appPid || previous.appStart !== next.appStart;
}

/** What the journal says about cmux now. */
export type CmuxHang =
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" }
  | { readonly kind: "responsive" }
  | {
      readonly kind: "unresponsive";
      readonly appPid: number;
      /** The first reading of the unbroken unanswered run. */
      readonly sinceIso: string;
      /** Whether the run has lasted the bound. */
      readonly overBound: boolean;
    };

/**
 * Every reading in the journal, in order, after the newest declined dialog: a decline cleared what held cmux, so a
 * hang still there afterwards is a new run, and the restart waits out a fresh bound rather than ending every seat's
 * turn over a cause already gone.
 */
function readingsOf({ events }: { events: readonly CmuxReviveEvent[] }): readonly CmuxReading[] {
  const declined = events.findLastIndex((event) => event.kind === "dialog-dismissed");
  return events.slice(declined + 1).filter((event): event is CmuxReading => event.kind === "reading");
}

/**
 * The newest reading since the last declined dialog — what a fresh reading is compared with, so the first one after
 * a decline is always journalled even when it repeats one from before it.
 *
 * @param events the journal
 * @returns the reading, or `undefined` when none follows the decline
 */
export function newestReading({ events }: { events: readonly CmuxReviveEvent[] }): CmuxReading | undefined {
  return readingsOf({ events }).at(-1);
}

/** Whether two readings are the same app: a reopened one is a new pid or a new start. */
function sameApp({ a, b }: { a: CmuxReading; b: CmuxReading }): boolean {
  return a.appPid === b.appPid && a.appStart === b.appStart;
}

/**
 * The first reading of the unanswered run ending at the anchor: walk back over the anchor's app, stepping over its
 * unprobed readings, until another app, an answer, or a gap wider than `maxGapMs`.
 */
function runStartOf({
  readings,
  anchorIndex,
  maxGapMs,
}: {
  readings: readonly CmuxReading[];
  anchorIndex: number;
  maxGapMs: number;
}): string {
  const anchor = readings[anchorIndex]!;
  let sinceIso = anchor.atIso;
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const reading = readings[index]!;
    const app = sameApp({ a: reading, b: anchor });
    if (app && reading.state === "unprobed") {
      continue;
    }
    const watched = Date.parse(sinceIso) - Date.parse(reading.atIso) <= maxGapMs;
    if (!app || !watched || !isUnanswered({ state: reading.state })) {
      break;
    }
    sinceIso = reading.atIso;
  }
  return sinceIso;
}

/**
 * Judge the newest reading, walking back through the unanswered run it ends: one app (pid and start), no
 * answer, no gap wider than `maxGapMs` between two unanswered readings. A reading older than that gap says nothing
 * about now. An `unprobed` reading — no seat called cmux lately — is transparent: it neither breaks the run nor
 * extends it, and a newest one keeps an open run open (so health still shows the hang) but never puts it over the
 * bound, so no restart fires on a reading with no fresh evidence. MEASURED: one `unprobed`
 * inside a stalled run read the fleet healthy and pushed the restart back by about eight minutes
 * (`~/.slopweaver/fleet/cmux-revive.jsonl`).
 *
 * @param events the journal
 * @param nowIso the instant judged
 * @param boundMs how long the run must last to be a hang the fleet acts on
 * @param maxGapMs the widest gap that keeps a run unbroken
 * @returns the verdict
 */
export function judgeHang({
  events,
  nowIso,
  boundMs,
  maxGapMs,
}: {
  events: readonly CmuxReviveEvent[];
  nowIso: string;
  boundMs: number;
  maxGapMs: number;
}): CmuxHang {
  const readings = readingsOf({ events });
  const newest = readings.at(-1);
  const nowMs = Date.parse(nowIso);
  if (newest === undefined || nowMs - Date.parse(newest.atIso) > maxGapMs) {
    return { kind: "unknown" };
  }
  if (newest.state === "absent") {
    return { kind: "absent" };
  }
  if (newest.state === "answering") {
    return { kind: "responsive" };
  }
  const unprobed = newest.state === "unprobed";
  // The newest unanswered reading of the newest app, stepping over its unprobed readings.
  let anchorIndex = readings.length - 1;
  while (
    anchorIndex >= 0 &&
    readings[anchorIndex]!.state === "unprobed" &&
    sameApp({ a: readings[anchorIndex]!, b: newest })
  ) {
    anchorIndex -= 1;
  }
  const anchor = readings[anchorIndex];
  if (
    anchor === undefined ||
    !sameApp({ a: anchor, b: newest }) ||
    !isUnanswered({ state: anchor.state }) ||
    nowMs - Date.parse(anchor.atIso) > maxGapMs ||
    anchor.appPid === null
  ) {
    // An unanswered reading names its app by construction (`classifyProbe`); one that does not is unjudgeable.
    return { kind: "unknown" };
  }
  const sinceIso = runStartOf({ anchorIndex, maxGapMs, readings });
  return {
    appPid: anchor.appPid,
    kind: "unresponsive",
    overBound: !unprobed && nowMs - Date.parse(sinceIso) >= boundMs,
    sinceIso,
  };
}

/** Whether a restart may run now, and if not, until when it is held — a loop is held while its hang lasts. */
export type RestartAllowance =
  | { readonly kind: "allowed" }
  | { readonly kind: "cooldown" | "capped"; readonly untilIso: string }
  | { readonly kind: "recurring" };

/**
 * Whether the fleet may restart cmux now: never for a hang recurring after a restart that was itself for a recurring
 * one (`./recurrence.ts`), none in the cooldown, fewer than the cap in the day.
 *
 * @param events the journal
 * @param hang the open verdict, whose run start decides whether it is a loop
 * @param nowIso the instant judged
 * @returns the allowance
 */
export function restartAllowance({
  events,
  hang,
  nowIso,
}: {
  events: readonly CmuxReviveEvent[];
  hang: CmuxHang;
  nowIso: string;
}): RestartAllowance {
  if (hang.kind === "unresponsive" && recurringHoldOrigin({ events, hungSinceIso: hang.sinceIso }) !== undefined) {
    return { kind: "recurring" };
  }
  const nowMs = Date.parse(nowIso);
  const starts = events
    .filter((event) => event.kind === "restart-started")
    .map((event) => Date.parse(event.atIso))
    .filter((atMs) => nowMs - atMs < DAY_MS);
  const newest = starts.at(-1);
  if (newest !== undefined && nowMs - newest < RESTART_COOLDOWN_MS) {
    return { kind: "cooldown", untilIso: new Date(newest + RESTART_COOLDOWN_MS).toISOString() };
  }
  const oldest = starts[0];
  if (oldest !== undefined && starts.length >= RESTART_DAILY_CAP) {
    return { kind: "capped", untilIso: new Date(oldest + DAY_MS).toISOString() };
  }
  return { kind: "allowed" };
}

/** What one `cmux revive` does with a verdict. */
export type ReviveAction =
  | { readonly kind: "none" }
  | { readonly kind: "wait"; readonly sinceIso: string }
  | { readonly kind: "restart"; readonly appPid: number; readonly sinceIso: string }
  | {
      readonly kind: "held";
      readonly sinceIso: string;
      readonly allowance: Exclude<RestartAllowance, { kind: "allowed" }>;
    };

/**
 * Decide the act: restart a hang past its bound when allowed, hold it when not, wait inside the bound.
 *
 * @param hang the verdict
 * @param allowance whether a restart may run now
 * @returns the act
 */
export function reviveAction({ hang, allowance }: { hang: CmuxHang; allowance: RestartAllowance }): ReviveAction {
  if (hang.kind !== "unresponsive") {
    return { kind: "none" };
  }
  if (!hang.overBound) {
    return { kind: "wait", sinceIso: hang.sinceIso };
  }
  if (allowance.kind !== "allowed") {
    return { allowance, kind: "held", sinceIso: hang.sinceIso };
  }
  return { appPid: hang.appPid, kind: "restart", sinceIso: hang.sinceIso };
}

/** What `fleet health` shows about cmux itself, with the recurrence it carries when the hang came back. */
export type CmuxFleetState = (
  | { readonly kind: "answering" | "unmeasured" }
  | { readonly kind: "restarting"; readonly sinceIso: string }
  | { readonly kind: "unresponsive"; readonly sinceIso: string; readonly held: boolean }
) & { readonly recurring?: CmuxFleetRecurrence };

/** How long a restart may sit unfinished before health stops calling it in flight: the effect bounds it far below. */
const RESTART_IN_FLIGHT_MS = 10 * 60_000;

/**
 * cmux as the sessions page reads it: a restart in flight, a hang the fleet is waiting out or has stopped
 * restarting, or nothing to say — each carrying the recurrence when the hang came back after a restart, and for
 * the hour after a loop's restart (`./recurrence.ts`).
 *
 * @param events the journal
 * @param nowIso the instant judged
 * @returns the state
 */
export function cmuxFleetState({
  events,
  nowIso,
}: {
  events: readonly CmuxReviveEvent[];
  nowIso: string;
}): CmuxFleetState {
  const state = cmuxFleetStateOf({ events, nowIso });
  const openHangSinceIso = state.kind === "unresponsive" ? state.sinceIso : undefined;
  const recurring = fleetRecurrence({ events, nowIso, openHangSinceIso });
  return recurring === undefined ? state : { ...state, recurring };
}

/** The state alone, before its recurrence. */
function cmuxFleetStateOf({ events, nowIso }: { events: readonly CmuxReviveEvent[]; nowIso: string }): CmuxFleetState {
  const nowMs = Date.parse(nowIso);
  const newest = events.at(-1);
  if (newest?.kind === "restart-started" && nowMs - Date.parse(newest.atIso) < RESTART_IN_FLIGHT_MS) {
    return { kind: "restarting", sinceIso: newest.atIso };
  }
  // A finished restart outranks the readings before it, which are the OLD app's: until the next probe it says how
  // the new one came up.
  if (newest?.kind === "restart-finished") {
    if (newest.outcome === "answering") {
      return { kind: "answering" };
    }
    return { held: false, kind: "unresponsive", sinceIso: newest.atIso };
  }
  const hang = judgeHang({ boundMs: DEFAULT_HANG_BOUND_MS, events, maxGapMs: MAX_READING_GAP_MS, nowIso });
  if (hang.kind === "unresponsive") {
    const held = hang.overBound && restartAllowance({ events, hang, nowIso }).kind !== "allowed";
    return { held, kind: "unresponsive", sinceIso: hang.sinceIso };
  }
  return { kind: hang.kind === "responsive" ? "answering" : "unmeasured" };
}
