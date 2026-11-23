/**
 * The one-click update, decided: what the menu bar offers, the update the app has launched and is waiting on, the
 * outcome it reads back, and whether a call ended for it is owed a restart. Pure; `updateShell.ts` does it.
 *
 * The sidebar offers an Update button and the menu bar another, as other apps do, rather than telling the owner to run
 * "`slopweaver desktop install` from the main checkout"; on a call the app ends the call, updates and restarts the
 * call — and, when the update fails, brings the old app back with the call restarted, so the voice can help the owner
 * find out what happened. The update itself is `slopweaver desktop update`, run from the checkout;
 * the outcome record it writes is the shape `src/desktop/updateOutcome.ts` declares — a separate project, so the
 * shape is written twice and each side checks what it reads.
 */
import { join } from "node:path";

import { isRecord } from "./desktopBridge";

/** The longest label the console may put on the menu bar's update item. */
const MAX_LABEL = 64;

/**
 * What the console page offers to do about the builds, as it publishes it to the menu bar: the button's own words,
 * and whether pressing it does anything now.
 */
export interface UpdateOffer {
  readonly label: string;
  readonly enabled: boolean;
}

/**
 * One offer off the wire: exactly `{ label, enabled }`, a short one-line label — or `null`, nothing to offer.
 *
 * @param value what the page sent
 * @returns the offer, `null` for none, or `undefined` when it is not one
 */
export function parseUpdateOffer({ value }: { value: unknown }): UpdateOffer | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { label, enabled } = value;
  if (typeof label !== "string" || label.length === 0 || label.length > MAX_LABEL || /[\r\n]/u.test(label)) {
    return undefined;
  }
  if (typeof enabled !== "boolean") {
    return undefined;
  }
  return { enabled, label };
}

/** The update the app launched and has not yet read the outcome of — kept across the quit it causes. */
export interface PendingUpdate {
  readonly id: string;
  readonly startedIso: string;
  /** Where the update writes its outcome record. */
  readonly outcomePath: string;
  /** Where its output goes. */
  readonly logPath: string;
}

/** A call the app ended for an update, owed a restart once the update has settled. */
export interface ResumeVoice {
  readonly sinceIso: string;
}

/** The two saved fields the update keeps, each changed to a value, cleared with `null`, or left as it is. */
export interface UpdateFieldsChange {
  readonly update?: PendingUpdate | null;
  readonly resumeVoice?: ResumeVoice | null;
}

/** What one update came to, as the app read it back. */
export type UpdateOutcome =
  | {
      readonly kind: "updated";
      readonly finishedIso: string;
      readonly sha: string;
      readonly logPath: string | undefined;
    }
  | {
      readonly kind: "failed";
      readonly finishedIso: string;
      readonly code: string;
      readonly message: string;
      readonly rolledBack: boolean;
      readonly logPath: string | undefined;
    };

/** The longest failure message read back; the verb clips its own at 2000. */
const MAX_MESSAGE = 2000;

/**
 * A saved pending update, exactly: an id of the app's own shape, a parseable start, absolute paths.
 *
 * @param value the `update` field as parsed
 * @returns the pending update, or `undefined` when any part is malformed
 */
export function decodePendingUpdate({ value }: { value: unknown }): PendingUpdate | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    return undefined;
  }
  const { id, startedIso, outcomePath, logPath } = value;
  if (typeof id !== "string" || !/^[0-9a-z-]{1,64}$/u.test(id)) {
    return undefined;
  }
  if (typeof startedIso !== "string" || Number.isNaN(Date.parse(startedIso))) {
    return undefined;
  }
  if (typeof outcomePath !== "string" || !outcomePath.startsWith("/")) {
    return undefined;
  }
  if (typeof logPath !== "string" || !logPath.startsWith("/")) {
    return undefined;
  }
  return { id, logPath, outcomePath, startedIso };
}

/**
 * A saved call-restart flag, exactly.
 *
 * @param value the `resumeVoice` field as parsed
 * @returns the flag, or `undefined` when it is malformed
 */
export function decodeResumeVoice({ value }: { value: unknown }): ResumeVoice | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    return undefined;
  }
  const { sinceIso } = value;
  if (typeof sinceIso !== "string" || Number.isNaN(Date.parse(sinceIso))) {
    return undefined;
  }
  return { sinceIso };
}

/**
 * The outcome record `desktop update` wrote, read back.
 *
 * @param value the parsed JSON
 * @returns the outcome, or `undefined` when it is not one
 */
export function decodeUpdateOutcome({ value }: { value: unknown }): UpdateOutcome | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, finishedIso, logPath } = value;
  if (typeof finishedIso !== "string" || Number.isNaN(Date.parse(finishedIso))) {
    return undefined;
  }
  if (logPath !== undefined && (typeof logPath !== "string" || !logPath.startsWith("/"))) {
    return undefined;
  }
  if (kind === "updated") {
    const { sha } = value;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha)) {
      return undefined;
    }
    return { finishedIso, kind, logPath, sha };
  }
  if (kind !== "failed") {
    return undefined;
  }
  const { code, message, rolledBack } = value;
  if (typeof code !== "string" || !/^[A-Z_]{1,64}$/u.test(code) || typeof rolledBack !== "boolean") {
    return undefined;
  }
  if (typeof message !== "string" || message.length > MAX_MESSAGE) {
    return undefined;
  }
  return { code, finishedIso, kind, logPath, message, rolledBack };
}

/**
 * How long a launched update may take before the app stops waiting for its record: the build is minutes, and the
 * install then holds the new app open for a while before it trusts it.
 */
export const UPDATE_GIVE_UP_MS = 20 * 60_000;

/** How often the app looks for the outcome record while an update runs. */
export const UPDATE_POLL_MS = 3_000;

/**
 * The outcome to show when the record never came: the update was killed, or its output says why.
 *
 * @returns a failed outcome naming the log
 */
export function lostOutcome({ pending, nowIso }: { pending: PendingUpdate; nowIso: string }): UpdateOutcome {
  return {
    code: "UPDATE_LOST",
    finishedIso: nowIso,
    kind: "failed",
    logPath: pending.logPath,
    message:
      `the update started at ${pending.startedIso} never wrote how it ended; it may have been stopped part way; ` +
      `its output is at ${pending.logPath}`,
    rolledBack: false,
  };
}

/**
 * Whether to keep waiting for a launched update's record. The bound is wall-clock, because the pending update is
 * saved across the quit it causes: a clock moved back while an update hangs delays the give-up by as much.
 *
 * @param pending the launched update
 * @param exited whether the update's own process is known to have exited (only the app that launched it can know)
 * @param nowMs the clock
 * @returns `wait` while it may still be running, `lost` once it cannot be
 */
export function pendingVerdict({
  pending,
  exited,
  nowMs,
}: {
  pending: PendingUpdate;
  exited: boolean;
  nowMs: number;
}): "wait" | "lost" {
  const started = Date.parse(pending.startedIso);
  if (exited || Number.isNaN(started) || nowMs - started > UPDATE_GIVE_UP_MS) {
    return "lost";
  }
  return "wait";
}

/**
 * How long after a call was ended for an update it is still restarted. An update that took longer than this is one
 * the owner has long since walked away from, and a call starting by itself then would be a surprise, not a restart.
 */
export const RESUME_WITHIN_MS = UPDATE_GIVE_UP_MS + 5 * 60_000;

/**
 * Whether a call ended for an update is still owed its restart.
 *
 * @param resume the saved flag
 * @param nowMs the clock
 * @returns true within {@link RESUME_WITHIN_MS} of the call ending, either side of now — a flag dated after now is
 *   a clock moved back since the hang-up, still recent; one further out than the window is refused
 */
export function resumeDue({ resume, nowMs }: { resume: ResumeVoice; nowMs: number }): boolean {
  const since = Date.parse(resume.sinceIso);
  if (Number.isNaN(since)) {
    return false;
  }
  return Math.abs(nowMs - since) <= RESUME_WITHIN_MS;
}

/**
 * What to do, now, about a call owed a restart. The flag is cleared only on `hand` once the start has actually been
 * handed to a listening voice page, on `expired`, or on `call-live` — a call already up IS the restart, the owner's own press
 * included, and one owed after it would start a second call the moment the owner hung up. Anything else keeps the
 * flag and looks again: clearing it first and then finding nothing to hand the start to loses the restart, a call
 * ended for an update and never started again.
 */
export type ResumeDecision =
  | { readonly kind: "hand" }
  | { readonly kind: "retry"; readonly reason: "hanging-up" | "overlay-not-listening" }
  | { readonly kind: "clear"; readonly reason: "expired" | "call-live" };

/**
 * Decide a call owed a restart: expired first, then the shell's own hang-up still under way, then a call already up,
 * then a voice page not yet listening.
 *
 * @param resume the saved flag
 * @param nowMs the clock
 * @param hangingUp whether the shell is still waiting on the hang-up it asked for: a call up then is the one being
 *   ended, never a restart, so clearing on it would drop what that hang-up is about to owe
 * @param callLive whether a call is up now, in either window
 * @param overlayListening whether a voice page is loaded and has reported itself, so a start sent now is heard
 * @returns hand the start over, look again shortly, or clear the flag and why
 */
export function resumeDecision({
  resume,
  nowMs,
  hangingUp,
  callLive,
  overlayListening,
}: {
  resume: ResumeVoice;
  nowMs: number;
  hangingUp: boolean;
  callLive: boolean;
  overlayListening: boolean;
}): ResumeDecision {
  if (!resumeDue({ nowMs, resume })) {
    return { kind: "clear", reason: "expired" };
  }
  if (hangingUp) {
    return { kind: "retry", reason: "hanging-up" };
  }
  if (callLive) {
    return { kind: "clear", reason: "call-live" };
  }
  if (!overlayListening) {
    return { kind: "retry", reason: "overlay-not-listening" };
  }
  return { kind: "hand" };
}

/** What one look at a call owed a restart came to, as the shell's event log records it. */
export type ResumeLogDecision =
  "handed" | "expired" | "call-live" | "retry-hanging-up" | "retry-overlay-not-listening" | "retry-send-failed";

/**
 * One line of the shell's event log (`desktopEventLog.ts`) for a call owed a restart, written once per change of
 * decision, so a restart that never came says why. `sinceIso` is the saved flag's own instant, the key that ties the
 * looks at one ended call together; nothing the owner said is in it.
 */
export interface UpdateResumeEntry {
  readonly kind: "update-resume";
  readonly atIso: string;
  readonly sinceIso: string;
  readonly decision: ResumeLogDecision;
  /**
   * Which app wrote it: the owner's own, or a `desktop e2e` test instance. The log is shared between them, so a test judging
   * its own restart reads only its own lines.
   */
  readonly instance: "own" | "e2e";
}

/**
 * The log's word for a decision.
 *
 * @param decision the decision taken
 * @returns how the event log names it
 */
export function resumeLogDecision({ decision }: { decision: ResumeDecision }): ResumeLogDecision {
  switch (decision.kind) {
    case "hand":
      return "handed";
    case "retry":
      return `retry-${decision.reason}`;
    case "clear":
      return decision.reason;
    default: {
      const unhandled: never = decision;
      return unhandled;
    }
  }
}

/**
 * How long a swap — a held console build that swaps in once its call ends — may take before the shell reloads onto
 * whatever is served and restarts the call. The shell owns it, not the page: a console-outage reload of the page took
 * the page's own timer with it, and the call was left ended.
 */
export const SWAP_WAIT_MS = 3 * 60_000;

/**
 * Where one update's record and output go. The program itself is spelled at the one call that starts it
 * (`updateShell.ts`: the checkout's own `bin/slopweaver desktop update`), not returned from here, so rule 2's
 * `no-headless` gate recognises that call by what it runs rather than by a helper that could be handed anything.
 *
 * @param folder the app's own folder for update records (`userData/updates`)
 * @param id this update's id
 * @returns the update's two paths
 */
export function updateLaunch({ folder, id }: { folder: string; id: string }): {
  readonly outcomePath: string;
  readonly logPath: string;
} {
  return { logPath: join(folder, `${id}.log`), outcomePath: join(folder, `${id}.json`) };
}

/** What the menu bar's update item is: its words, and what a click does. */
export interface TrayUpdateItem {
  readonly label: string;
  readonly enabled: boolean;
  /** `run` asks the console page to do what its button does; `check` opens the window on the build fold. */
  readonly click: "run" | "check" | undefined;
}

/**
 * The menu bar's update item: "Updating…" while an update runs, the console's own offer when it has one, else
 * "Check for Updates…".
 *
 * @param offer the console page's last offer, or `null` for none
 * @param running whether an update the app launched is still running
 * @returns the item
 */
export function trayUpdateItem({ offer, running }: { offer: UpdateOffer | null; running: boolean }): TrayUpdateItem {
  if (running) {
    return { click: undefined, enabled: false, label: "Updating…" };
  }
  if (offer !== null) {
    if (!offer.enabled) {
      return { click: undefined, enabled: false, label: offer.label };
    }
    return { click: "run", enabled: true, label: offer.label };
  }
  return { click: "check", enabled: true, label: "Check for Updates…" };
}

/**
 * The menu bar's line for the last update's outcome, so a failure is visible there too.
 *
 * @param outcome the last outcome this app read, or `undefined` before any
 * @returns the line, or `undefined` when there is none or it succeeded
 */
export function trayOutcomeLine({ outcome }: { outcome: UpdateOutcome | undefined }): string | undefined {
  if (outcome?.kind !== "failed") {
    return undefined;
  }
  if (outcome.rolledBack) {
    return "Update failed. The previous app was put back";
  }
  return "Update failed. This app kept running";
}
