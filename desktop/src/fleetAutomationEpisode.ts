/**
 * One down episode's memory and the step each fleet reading takes on it: when the shell launches a recovery by
 * itself, what the owner's button counts, when a launch is still pending, and the saved memory read back. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";
import { type StateError, StateErrors } from "./errors";
import type { FleetHealth } from "./fleetHealth";

/** What the shell remembers about the current episode, version 1. */
export interface FleetAutomation {
  readonly version: 1;
  /** The open episode, or `null` while the fleet is not down. */
  readonly episodeId: string | null;
  /** How many attempts this episode has launched, automatic or by the owner's button. */
  readonly launches: number;
  /** The deferred attempt the last automatic continuation picked up, so the same deferral is never continued twice. */
  readonly continuedAttempt: string | null;
  /** The hand step whose floating note the owner closed, so it is not shown again for the same cause. */
  readonly dismissedStep: string | null;
  /**
   * The app's own last line, until a reading shows an attempt finished after it: `after` is the finished attempt the
   * readings named when it was typed. `null` once one has, or when the last launch was the owner's button's.
   */
  readonly awaiting: { readonly after: string | null } | null;
}

/** No episode open. */
export const NO_EPISODE: FleetAutomation = {
  awaiting: null,
  continuedAttempt: null,
  dismissedStep: null,
  episodeId: null,
  launches: 0,
  version: 1,
};

/**
 * The most launches one episode makes by itself: the first attempt and up to three continuations. A bound on a
 * deferral that never stops repeating, not a measurement — past it the page's reason stands and the button is the owner's.
 */
export const MAX_LAUNCHES = 4;

/** A minted episode id: a v4 UUID, so it is safe to type. */
export const EPISODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** What one reading decides. */
export interface FleetStep {
  readonly automation: FleetAutomation;
  /** Launch an automatic attempt now. */
  readonly launch: boolean;
}

/** What one reading says that the automation acts on. */
export type FleetReading = Pick<FleetHealth, "state" | "recoveryPhase" | "lastAttempt">;

/**
 * The deferred attempt this episode may continue now, or `undefined` when there is none to continue.
 *
 * @param automation the open episode
 * @param reading the fleet's reading, with no attempt running
 * @returns the deferred attempt's id
 */
function deferralToContinue({
  automation,
  reading,
}: {
  automation: FleetAutomation;
  reading: FleetReading;
}): string | undefined {
  const last = reading.lastAttempt;
  const continuable =
    last?.outcome === "deferred" &&
    last.episodeId === automation.episodeId &&
    last.attemptId !== automation.continuedAttempt &&
    automation.launches > 0 &&
    automation.launches < MAX_LAUNCHES;
  return continuable ? last.attemptId : undefined;
}

/** The newest finished attempt a reading names, `null` when it names none. */
function finishedAttemptId({ reading }: { reading: FleetReading }): string | null {
  if (reading.lastAttempt === undefined) {
    return null;
  }
  return reading.lastAttempt.attemptId;
}

/** The episode with its awaited line settled once a reading shows an attempt finished after it. */
function settleAwaiting({
  automation,
  reading,
}: {
  automation: FleetAutomation;
  reading: FleetReading;
}): FleetAutomation {
  if (automation.awaiting === null || automation.awaiting.after === finishedAttemptId({ reading })) {
    return automation;
  }
  return { ...automation, awaiting: null };
}

/**
 * Apply one reading.
 *
 * @param automation what was remembered before it
 * @param reading the fleet's state, its running attempt's phase and its newest finished attempt
 * @param blocked the shell's own last launch failed and the owner has not acted on it yet
 * @param mint mints an episode id when one opens
 * @returns the new memory, and whether to launch
 */
export function stepFleetAutomation({
  automation,
  reading,
  blocked,
  mint,
}: {
  automation: FleetAutomation;
  reading: FleetReading;
  blocked: boolean;
  mint: () => string;
}): FleetStep {
  const { state } = reading;
  // Degraded closes the episode like healthy: the held seat is the supervisor's, and a later failure — the
  // supervisor itself going down — must open a fresh episode with its own launch.
  if (state === "healthy" || state === "degraded") {
    return { automation: NO_EPISODE, launch: false };
  }
  // A running attempt is never doubled; and `recovering` outside an episode is a fleet settling by itself, which
  // opens nothing. Inside one, `recovering` with nothing running is a deferral waiting to be continued.
  const running = reading.recoveryPhase !== undefined;
  if (running || (state === "recovering" && automation.episodeId === null)) {
    return { automation, launch: false };
  }
  let open = automation;
  if (open.episodeId === null) {
    open = { ...NO_EPISODE, episodeId: mint() };
  }
  open = settleAwaiting({ automation: open, reading });
  if (blocked) {
    return { automation: open, launch: false };
  }
  const awaiting = { after: finishedAttemptId({ reading }) };
  if (open.launches === 0) {
    return state === "down"
      ? { automation: { ...open, awaiting, launches: 1 }, launch: true }
      : { automation: open, launch: false };
  }
  // The app's last line finished no attempt and nothing runs, past the shell's pending bound: it never ran, or its
  // pass died before it finished. Type it again, within the same cap.
  if (open.awaiting !== null && open.launches < MAX_LAUNCHES) {
    return { automation: { ...open, launches: open.launches + 1 }, launch: true };
  }
  const deferred = deferralToContinue({ automation: open, reading });
  if (deferred === undefined) {
    return { automation: open, launch: false };
  }
  return {
    automation: { ...open, awaiting, continuedAttempt: deferred, launches: open.launches + 1 },
    launch: true,
  };
}

/**
 * The owner's button launches an attempt: inside the open episode, or opening one — a hand step visible to the owner is always inside
 * one. The press always launches, never refused at the cap, but it counts, so the app continues fewer by itself after.
 *
 * @param automation the memory before the press
 * @param mint a fresh episode id, used only when none is open
 * @returns the episode the attempt belongs to and the memory with that launch counted
 */
export function pressButton({ automation, mint }: { automation: FleetAutomation; mint: () => string }): {
  automation: FleetAutomation;
  episodeId: string;
} {
  // The press is the owner's: a line that waits on the owner (a sign-in) is never typed again over it, so nothing is awaited.
  if (automation.episodeId !== null) {
    return {
      automation: { ...automation, awaiting: null, launches: automation.launches + 1 },
      episodeId: automation.episodeId,
    };
  }
  const episodeId = mint();
  return { automation: { ...NO_EPISODE, episodeId, launches: 1 }, episodeId };
}

/** A launch typed into cmux whose attempt no reading has shown yet. */
export interface PendingLaunch {
  /** When the launch was typed, epoch ms. */
  readonly atMs: number;
  /** The finished attempt the readings named when it was typed, so a new one shows the launch was taken up. */
  readonly lastAttemptId: string | undefined;
}

/**
 * How long a launch holds every other launch back without a reading showing its attempt: a pass journals its start
 * before it does anything slow, so past this the typed line never ran (a tab closed, a shell that refused it).
 */
const PENDING_LAUNCH_MS = 120_000;

/**
 * Whether a launch still holds back every other one, so a second click on the same button, or the app's own
 * continuation, never starts a second pass beside it. Released once a reading shows an attempt running or a newer
 * one finished, or once the bound passes with neither.
 *
 * @param pending the launch typed last, if any
 * @param reading the newest reading
 * @param nowMs the time of the reading
 * @returns whether to hold every launch back
 */
export function launchPending({
  pending,
  reading,
  nowMs,
}: {
  pending: PendingLaunch | undefined;
  reading: FleetReading;
  nowMs: number;
}): boolean {
  if (pending === undefined || reading.recoveryPhase !== undefined) {
    return false;
  }
  if (reading.lastAttempt !== undefined && reading.lastAttempt.attemptId !== pending.lastAttemptId) {
    return false;
  }
  return nowMs - pending.atMs < PENDING_LAUNCH_MS;
}

/**
 * A launch that never reached cmux was no attempt: give the episode that launch back. An automatic launch releases
 * the deferral it would have continued too, so the next reading continues it; a button's continued none.
 *
 * @param automation the memory after the launch was decided
 * @param automatic whether the app launched it by itself rather than by the owner's button
 * @returns the same episode, one launch fewer
 */
export function launchDidNotHappen({
  automation,
  automatic,
}: {
  automation: FleetAutomation;
  automatic: boolean;
}): FleetAutomation {
  const launches = Math.max(0, automation.launches - 1);
  if (!automatic) {
    return { ...automation, launches };
  }
  return { ...automation, awaiting: null, continuedAttempt: null, launches };
}

/**
 * Read the saved memory back, refusing anything that is not exactly version 1.
 *
 * @param value the parsed JSON
 * @returns the memory, or which field was malformed
 */
export function decodeFleetAutomation({ value }: { value: unknown }): Result<FleetAutomation, StateError> {
  if (!isRecord(value) || value["version"] !== 1) {
    return err(StateErrors.malformed({ field: "fleet.version" }));
  }
  const { awaiting, episodeId, launches, continuedAttempt, dismissedStep } = value;
  if (episodeId !== null && (typeof episodeId !== "string" || !EPISODE_ID.test(episodeId))) {
    return err(StateErrors.malformed({ field: "fleet.episodeId" }));
  }
  if (typeof launches !== "number" || !Number.isInteger(launches) || launches < 0) {
    return err(StateErrors.malformed({ field: "fleet.launches" }));
  }
  if (continuedAttempt !== null && typeof continuedAttempt !== "string") {
    return err(StateErrors.malformed({ field: "fleet.continuedAttempt" }));
  }
  if (dismissedStep !== null && typeof dismissedStep !== "string") {
    return err(StateErrors.malformed({ field: "fleet.dismissedStep" }));
  }
  if (awaiting === null) {
    return ok({ awaiting, continuedAttempt, dismissedStep, episodeId, launches, version: 1 });
  }
  if (!isRecord(awaiting) || (awaiting["after"] !== null && typeof awaiting["after"] !== "string")) {
    return err(StateErrors.malformed({ field: "fleet.awaiting" }));
  }
  return ok({
    awaiting: { after: awaiting["after"] },
    continuedAttempt,
    dismissedStep,
    episodeId,
    launches,
    version: 1,
  });
}
