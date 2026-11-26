/**
 * The chair half of `slopweaver fleet recover`, pure: what the press read of the supervisor before deciding whether to
 * restart it, what one look at a restarted chair says, and the line the result carries.
 *
 * **Only a chair that is down is restarted.** A chair its host still holds is left alone, however long it has been
 * quiet: replacing a running supervisor is the owner's call, and the owner makes it by pressing Stop on its card,
 * then Recovery. A chair already starting is left to finish, so a second press opens no second one. Where the press
 * cannot tell, it restarts nothing and says why.
 *
 * **Restarted means the pin moved.** A card opening proves only that the app started a session. The chair is
 * restarted once the supervisor pin names that session and the app still runs it, which only `cmux takeover`, run by
 * the new chair itself, can make true.
 */
import type { AppSessionSnapshot } from "../sessionHarness/appProtocol.js";
import { boundedReason, type RecoveryVendor } from "./recoveryCheck.js";
import type { RecoveryPredecessor } from "./recoverySuccessor.js";

/** What the press read of the supervisor before deciding. */
export type RecoveryChairReading =
  | { readonly kind: "live"; readonly label: string }
  | { readonly kind: "booting"; readonly label: string; readonly slug: string }
  | { readonly kind: "down"; readonly why: string; readonly predecessor?: RecoveryPredecessor }
  | { readonly kind: "unknown"; readonly why: string };

/** One chair the press opened, or tried to, and what became of it. */
export interface RecoveryRestartAttempt {
  readonly vendor: RecoveryVendor;
  readonly alias: string;
  readonly slug?: string;
  readonly sessionId?: string;
  /**
   * `lost` is a chair that took the pin and then ended or lost it: its run is a supervisor's own, so its row is never
   * closed as one that never sat, and nothing is opened after it, since a new chair would take over from that run.
   */
  readonly outcome: "restarted" | "starting" | "spawn-refused" | "ended" | "lost" | "deadline";
  readonly reason: string;
}

/** The chair's line in the result. */
export interface RecoveryChairResult {
  readonly outcome: "live" | "restarted" | "starting" | "not-restarted";
  readonly reason: string;
  /** Every chair the press opened or tried to, in order. */
  readonly restarts: readonly RecoveryRestartAttempt[];
}

/** The supervisor pin as one look reads it. */
export type RecoveryPinLook =
  | { readonly kind: "app"; readonly appSessionId: string }
  | { readonly kind: "cmux"; readonly workspaceRef: string }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly why: string };

/** What one look at a restarted chair says. */
export type RecoveryChairLook =
  | { readonly kind: "waiting" }
  | { readonly kind: "restarted" }
  | { readonly kind: "ended" | "lost" | "starting"; readonly reason: string };

/** How each vendor is named in a reason. */
const VENDOR_NAMES: Readonly<Record<RecoveryVendor, string>> = { claude: "Claude", codex: "Codex" };

/**
 * Whether the app has ended a session, or is ending it: a chair in any of these states holds no seat.
 *
 * @param state the session's state as the app lists it
 * @returns true once it is closed, failed or stopping
 */
export function appSessionEnded({ state }: { state: AppSessionSnapshot["state"] }): boolean {
  return state === "closed" || state === "failed" || state === "stopping";
}

/** A chair the app no longer runs: lost when the pin already names it, else ended before it took the pin. */
function goneLook({ pinned, went }: { pinned: boolean; went: string }): RecoveryChairLook {
  if (pinned) {
    return { kind: "lost", reason: `the new chair took the pin, then ${went}` };
  }
  return { kind: "ended", reason: `the new chair ${went} before it took the pin` };
}

/**
 * Judge one look at the chair the press opened. The pin is read BEFORE the app is listed, so a matching pin beside a
 * running snapshot means both held at the moment of the list, never a stale snapshot beside a pin that moved later.
 *
 * @param sessionId the app's id for the chair
 * @param snapshot the chair as the app lists it now, or `undefined` when it lists no such session
 * @param pin the supervisor pin, read just before that list
 * @param deadlinePassed whether the press's time is up
 * @returns whether to keep waiting, that it restarted, or why not
 */
export function judgeRecoveryChair({
  sessionId,
  snapshot,
  pin,
  deadlinePassed,
}: {
  sessionId: string;
  snapshot: Pick<AppSessionSnapshot, "state"> | undefined;
  pin: RecoveryPinLook;
  deadlinePassed: boolean;
}): RecoveryChairLook {
  const pinned = pin.kind === "app" && pin.appSessionId === sessionId;
  if (snapshot === undefined) {
    return goneLook({ pinned, went: "left the app's list" });
  }
  if (appSessionEnded({ state: snapshot.state })) {
    return goneLook({ pinned, went: `was ${snapshot.state}` });
  }
  if (pinned) {
    return { kind: "restarted" };
  }
  if (deadlinePassed) {
    return { kind: "starting", reason: startingReason({ pin }) };
  }
  return { kind: "waiting" };
}

/** What became of a chair that had taken the pin, by what one later look shows. */
function wentOf({ snapshot }: { snapshot: Pick<AppSessionSnapshot, "state"> | undefined }): string {
  if (snapshot === undefined) {
    return "left the app's list";
  }
  if (appSessionEnded({ state: snapshot.state })) {
    return `was ${snapshot.state}`;
  }
  return "the pin moved off it";
}

/**
 * A restarted chair looked at once more as the pass ends, since the other vendor's check can run for minutes after it
 * took the pin: it stays restarted only while the pin still names it and the app still runs it, and is lost otherwise.
 *
 * @param attempt the pass's last restart attempt
 * @param pin the supervisor pin, read just before the list `snapshot` came from
 * @param snapshot the chair as the app lists it now, or `undefined` when it lists no such session
 * @returns the attempt, unchanged unless a restarted chair no longer holds the seat
 */
export function reconfirmedRestart({
  attempt,
  pin,
  snapshot,
}: {
  attempt: RecoveryRestartAttempt;
  pin: RecoveryPinLook;
  snapshot: Pick<AppSessionSnapshot, "state"> | undefined;
}): RecoveryRestartAttempt {
  if (attempt.outcome !== "restarted") {
    return attempt;
  }
  const pinned = pin.kind === "app" && pin.appSessionId === attempt.sessionId;
  const running = snapshot !== undefined && !appSessionEnded({ state: snapshot.state });
  if (pinned && running) {
    return attempt;
  }
  return { ...attempt, outcome: "lost", reason: `the new chair took the pin, then ${wentOf({ snapshot })}` };
}

/** Why a chair still running at the deadline is not yet restarted, by what the pin says. */
function startingReason({ pin }: { pin: RecoveryPinLook }): string {
  if (pin.kind === "unreadable") {
    return boundedReason({ text: `the new chair is running, and the pin could not be read: ${pin.why}` });
  }
  return "the new chair is running and has not taken the pin yet";
}

/** The chair's line once the press restarted something, or tried to. */
function downResult({
  reading,
  restarts,
}: {
  reading: Extract<RecoveryChairReading, { kind: "down" }>;
  restarts: readonly RecoveryRestartAttempt[];
}): Pick<RecoveryChairResult, "outcome" | "reason"> {
  const last = restarts.at(-1);
  if (last === undefined) {
    return {
      outcome: "not-restarted",
      reason: boundedReason({ text: `${reading.why}, and no plan passed the check, so no chair was opened` }),
    };
  }
  const where = `${VENDOR_NAMES[last.vendor]} plan ${last.alias}`;
  if (last.outcome === "restarted") {
    return { outcome: "restarted", reason: boundedReason({ text: `the supervisor restarted on ${where}` }) };
  }
  if (last.outcome === "starting") {
    return {
      outcome: "starting",
      reason: boundedReason({ text: `a new supervisor is starting on ${where}: ${last.reason}` }),
    };
  }
  return {
    outcome: "not-restarted",
    reason: boundedReason({ text: `${reading.why}; the last chair tried, on ${where}, ${last.reason}` }),
  };
}

/**
 * The chair's line, from what the press read and every chair it opened.
 *
 * @param reading what the press read of the supervisor before deciding
 * @param restarts every chair it opened or tried to, in order
 * @returns the line
 */
export function recoveryChairResultOf({
  reading,
  restarts,
}: {
  reading: RecoveryChairReading;
  restarts: readonly RecoveryRestartAttempt[];
}): RecoveryChairResult {
  if (reading.kind === "live") {
    return {
      outcome: "live",
      reason: boundedReason({ text: `the supervisor is running on ${reading.label}, so nothing was restarted` }),
      restarts,
    };
  }
  if (reading.kind === "booting") {
    return {
      outcome: "starting",
      reason: boundedReason({
        text: `a supervisor is already starting on ${reading.label} (${reading.slug}), so no second one was opened`,
      }),
      restarts,
    };
  }
  if (reading.kind === "unknown") {
    return { outcome: "not-restarted", reason: boundedReason({ text: reading.why }), restarts };
  }
  return { ...downResult({ reading, restarts }), restarts };
}

/**
 * Whether a restart attempt leaves the chair still wanted: only one that never left a running chair behind.
 *
 * @param attempt the restart attempt
 * @returns true when the next plan may be tried
 */
export function restartFallsBack({ attempt }: { attempt: RecoveryRestartAttempt }): boolean {
  return attempt.outcome === "spawn-refused" || attempt.outcome === "ended";
}
