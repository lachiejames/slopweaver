/**
 * What the shell does about a call when the voice's renderer dies under it. A call can end this way inside two
 * minutes: the renderer runs out of memory, main reloads the page, and the page comes back knowing nothing — no end
 * on the transcript, the plan call left to its 30-second absent-stream timer, and the owner looking at an orb with
 * no call. So main remembers which call the page last reported
 * (`desktopBridge.ts` `OverlayCall`), and the page it reloads TAKES that recovery once it is up: it ends the dead plan
 * call with the crash as its reason, closes the transcript with the same words, and reconnects.
 *
 * Pull, not push: a page from before this never asks, so the recovery ages out ({@link RECOVERY_TAKE_MS}) rather than
 * reaching a later page as news. And a second crash inside {@link CRASH_RECOVERY_SETTLE_MS} still ends and closes its
 * call but does not reconnect, so a page that dies on every call cannot loop the owner through new ones. Pure.
 */
import type { OverlayCall } from "./desktopBridge";
import type { UpdateResumeEntry } from "./updatePlan";

/** Why a renderer went, as Electron's `render-process-gone` details carry it. */
export interface RendererGone {
  readonly reason: string;
  readonly exitCode: number;
}

/** What the reloaded page is handed: the call to end and close, the words to close it with, and whether to reconnect. */
export interface OverlayCrashRecovery {
  readonly transcriptCallId: string;
  readonly planCallId: string | null;
  readonly why: string;
  readonly crashedAtIso: string;
  readonly reconnect: boolean;
}

/**
 * A recovery main holds for the next page, and when it began holding it on a monotonic clock, so setting the Mac's
 * clock back can never make an aged-out recovery look fresh.
 */
export interface HeldRecovery {
  readonly recovery: OverlayCrashRecovery;
  readonly heldAtMonoMs: number;
}

/** One line of the shell's own event log (`desktopEventLog.ts`). */
export type DesktopEventEntry =
  | {
      readonly kind: "renderer-gone";
      readonly atIso: string;
      readonly window: "overlay";
      readonly reason: string;
      readonly exitCode: number;
      readonly call: OverlayCall | null;
      /** `null` when no call was up, so there was nothing to reconnect. */
      readonly reconnect: boolean | null;
    }
  | {
      readonly kind: "recovery-taken";
      readonly atIso: string;
      readonly transcriptCallId: string;
      readonly ageMs: number;
    }
  | ConsoleOutageEntry
  | UpdateResumeEntry;

/**
 * The console stopped answering, and what came of it (`consoleRestartHold.ts`): `held` as a restart is first waited
 * out, `back` once it answers again, `raised` once the note comes up. `downMs` runs from the first failed read, so a
 * `back` line is one measured outage — the evidence the restart window is sized from.
 */
export interface ConsoleOutageEntry {
  readonly kind: "console-outage";
  readonly atIso: string;
  readonly outcome: "held" | "back" | "raised";
  readonly downMs: number;
  /** Why the last read failed; `null` on `back`. */
  readonly problem: string | null;
}

/** A crash this soon after the last one ends its call without reconnecting, so a page dying every call is not a loop. */
export const CRASH_RECOVERY_SETTLE_MS = 60_000;

/**
 * How long a recovery waits for a page to take it. A reload is seconds; a page from before this never asks, and its
 * recovery must not reach some later page as a call to reconnect.
 */
export const RECOVERY_TAKE_MS = 120_000;

/** Electron's reasons in plain words, for the transcript's closed line and the page's banner. */
const GONE_WORDS: Readonly<Record<string, string>> = {
  "abnormal-exit": "exited abnormally",
  crashed: "crashed",
  "integrity-failure": "failed its code integrity check",
  killed: "was killed",
  "launch-failed": "failed to launch",
  "memory-eviction": "was evicted for memory",
  oom: "ran out of memory",
};

/**
 * The sentence a crash is recorded as: what happened to the voice window, and Electron's own reason and exit code, so
 * the transcript says why the call ended without a reader opening the log.
 *
 * @param gone Electron's reason and exit code
 * @returns one line
 */
export function rendererGoneWhy({ gone }: { gone: RendererGone }): string {
  let words = `went (${gone.reason})`;
  if (Object.hasOwn(GONE_WORDS, gone.reason)) {
    words = GONE_WORDS[gone.reason]!;
  }
  return `the voice window's renderer ${words} (${gone.reason}, exit ${String(gone.exitCode)})`;
}

/**
 * What a renderer death means: the log line, always, and the recovery to hold when a call was up. A replacement page
 * that dies before it takes the last death's recovery reported no call, yet that recovery's call is still the dead one,
 * so it stays held rather than being lost with nothing to end its call or close its transcript. It keeps
 * its first death's age, so it still ages out on time, and no longer reconnects: a page that died before it could ask
 * is one that cannot hold a call, so crashing pages can never carry it forward into a loop.
 *
 * @param call the call the page last reported, `null` when none was up
 * @param gone Electron's reason and exit code
 * @param held the recovery a previous death left untaken, `undefined` for none
 * @param nowMs the death's wall-clock instant, which only stamps the log and the transcript
 * @param monoMs the death's instant on the monotonic clock every age is measured on
 * @param lastCrashMonoMs the previous death's monotonic instant, `undefined` when this is the first
 * @returns the entry to log, and the recovery to hold for the next page, `undefined` when there is none to hold
 */
export function recoveryAfterRendererGone({
  call,
  gone,
  held,
  lastCrashMonoMs,
  monoMs,
  nowMs,
}: {
  call: OverlayCall | null;
  gone: RendererGone;
  held: HeldRecovery | undefined;
  lastCrashMonoMs: number | undefined;
  monoMs: number;
  nowMs: number;
}): { readonly entry: DesktopEventEntry; readonly held: HeldRecovery | undefined } {
  const atIso = new Date(nowMs).toISOString();
  const base = {
    atIso,
    exitCode: gone.exitCode,
    kind: "renderer-gone",
    reason: gone.reason,
    window: "overlay",
  } as const;
  if (call === null) {
    const entry: DesktopEventEntry = { ...base, call, reconnect: null };
    if (held === undefined || monoMs - held.heldAtMonoMs > RECOVERY_TAKE_MS) {
      return { entry, held: undefined };
    }
    return { entry, held: { heldAtMonoMs: held.heldAtMonoMs, recovery: { ...held.recovery, reconnect: false } } };
  }
  const reconnect = lastCrashMonoMs === undefined || monoMs - lastCrashMonoMs >= CRASH_RECOVERY_SETTLE_MS;
  const recovery: OverlayCrashRecovery = {
    crashedAtIso: atIso,
    planCallId: call.planCallId,
    reconnect,
    transcriptCallId: call.transcriptCallId,
    why: rendererGoneWhy({ gone }),
  };
  return { entry: { ...base, call, reconnect }, held: { heldAtMonoMs: monoMs, recovery } };
}

/**
 * The recovery a page that asks is handed: the held one while it is fresh, and nothing once it has aged out.
 *
 * @param held what main holds, `undefined` for nothing
 * @param nowMs when the page asked, on the wall clock, for the log
 * @param monoMs when the page asked, on the monotonic clock its age is measured on
 * @returns the recovery and the entry logging its taking, or `undefined` when there is none to take
 */
export function takeRecovery({
  held,
  monoMs,
  nowMs,
}: {
  held: HeldRecovery | undefined;
  monoMs: number;
  nowMs: number;
}): { readonly recovery: OverlayCrashRecovery; readonly entry: DesktopEventEntry } | undefined {
  if (held === undefined) {
    return undefined;
  }
  const ageMs = monoMs - held.heldAtMonoMs;
  if (ageMs > RECOVERY_TAKE_MS) {
    return undefined;
  }
  const entry: DesktopEventEntry = {
    ageMs,
    atIso: new Date(nowMs).toISOString(),
    kind: "recovery-taken",
    transcriptCallId: held.recovery.transcriptCallId,
  };
  return { entry, recovery: held.recovery };
}
