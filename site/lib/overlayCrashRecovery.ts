/**
 * The page's half of a call surviving the voice's renderer dying under it (`desktop/src/overlayRecovery.ts` is the
 * shell's). The voice reports the call it holds as it changes; when the renderer dies, the shell reloads the page and
 * the page TAKES what the shell held: the dead plan call to end with the crash as its reason, the transcript to close
 * with the same words, and whether to reconnect. Measured: before it, a renderer that ran out of memory left a
 * transcript with no end, a plan call waiting out its absent-stream timer, and an orb with no call. Written here and in the shell — two projects, so twice — and each side checks what it receives. Pure.
 */
import { isCallId, type TalkTranscriptWire, wireForInstance } from "./talkTranscript";

/** The call the voice holds, as it reports it to the shell: `null` from the shell's side is no call up. */
export interface OverlayCall {
  readonly transcriptCallId: string;
  /** The console's plan call, once minted; `null` while the call is still opening. */
  readonly planCallId: string | null;
}

/** What the shell hands the reloaded page: the call to end and close, why, when, and whether to reconnect. */
export interface OverlayCrashRecovery {
  readonly transcriptCallId: string;
  readonly planCallId: string | null;
  readonly why: string;
  readonly crashedAtIso: string;
  readonly reconnect: boolean;
}

/** The longest crash sentence carried, in characters: the shell words it in one line, and the stop route takes no more. */
export const CRASH_WHY_MAX = 512;

/** Whether a value is an object whose fields can be read by name. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a string is one bounded line of printable ASCII. The shell words every crash in English from Electron's own
 * ASCII reason (`desktop/src/overlayRecovery.ts` `rendererGoneWhy`), so an allowlist costs nothing and leaves nothing
 * that could split the server log's line or the transcript's, or hide in either: no control, format or invisible
 * character can pass.
 *
 * @param text the candidate
 * @returns whether it is non-blank, inside {@link CRASH_WHY_MAX}, and every character is printable ASCII (space to `~`)
 */
export function isCrashWhy({ text }: { text: string }): boolean {
  return text.trim() !== "" && text.length <= CRASH_WHY_MAX && /^[ -~]+$/u.test(text);
}

/**
 * One recovery off the shell. `null` is the shell's word that it held none, and reads as none, like anything else
 * that is not exactly one — a recovery half-read is never acted on.
 *
 * @param value what the shell answered
 * @returns the recovery, or `undefined` when there is none to act on
 */
export function overlayCrashRecoveryOf({ value }: { value: unknown }): OverlayCrashRecovery | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 5) {
    return undefined;
  }
  const { crashedAtIso, planCallId, reconnect, transcriptCallId, why } = value;
  if (typeof transcriptCallId !== "string" || !isCallId({ callId: transcriptCallId })) {
    return undefined;
  }
  if (planCallId !== null && (typeof planCallId !== "string" || !isCallId({ callId: planCallId }))) {
    return undefined;
  }
  if (typeof why !== "string" || !isCrashWhy({ text: why }) || typeof reconnect !== "boolean") {
    return undefined;
  }
  if (typeof crashedAtIso !== "string" || Number.isNaN(Date.parse(crashedAtIso))) {
    return undefined;
  }
  return { crashedAtIso, planCallId, reconnect, transcriptCallId, why };
}

/**
 * The batch that closes the dead call's transcript, at the instant it died and with the shell's words, so the record
 * says why it ended rather than stopping mid-sentence.
 *
 * @param recovery what the shell handed over
 * @param writeId the line's id, minted once so a retry appends it once
 * @param instance `e2e` on the desktop test instance, whose every batch carries its marker
 * @returns the wire to post
 */
export function crashedTranscriptWire({
  recovery,
  writeId,
  instance,
}: {
  recovery: OverlayCrashRecovery;
  writeId: string;
  instance: "e2e" | undefined;
}): TalkTranscriptWire {
  const wire: TalkTranscriptWire = {
    callId: recovery.transcriptCallId,
    lines: [{ atIso: recovery.crashedAtIso, kind: "closed", why: recovery.why, writeId }],
  };
  return wireForInstance({ instance, wire });
}

/** How the dead plan call's stop went: the server let it go (or already had), or why it did not. */
export type CrashStop = { readonly kind: "taken" } | { readonly kind: "refused" | "lost"; readonly why: string };

/** The things a recovery does, each a seam the page fills with its real post, and what it asks before reconnecting. */
export interface CrashRecoverySteps {
  readonly stopPlan: (input: { readonly callId: string; readonly why: string }) => Promise<CrashStop>;
  /** Post the closing batch; whether the route took it. */
  readonly closeTranscript: (input: { readonly wire: TalkTranscriptWire }) => Promise<boolean>;
  readonly reconnect: () => void;
  /** Whether a call or typed answer began on the page while the posts were out, so the reconnect would sit beside it. */
  readonly superseded: () => boolean;
}

/** What a recovery did, for the page to say when a step failed. */
export interface CrashRecoveryOutcome {
  /** `undefined` when the call died before the console minted it, so there was no plan call to end. */
  readonly stop: CrashStop | undefined;
  readonly closed: boolean;
  readonly reconnected: boolean;
  /** The owner started something themselves while the posts were out, so the recovery left the page to it. */
  readonly superseded: boolean;
}

/**
 * Recover one dead call, in order: end its plan call, close its transcript, then reconnect. The stop is awaited first
 * so a new call never opens beside the old one's realtime session; the close is awaited so the reconnect's opener,
 * which quotes the newest call file, reads the call as ended. A close the route refused still reconnects — the record
 * missing its last line is a smaller loss than the owner left with no call — while a stop that did not land does not, since
 * the old session may still hold the owner's voice; the server's absent-stream timer ends it within 30 seconds either way. A
 * call or typed answer the owner began while the posts were out wins: the page is idle while they run, so the owner's own press can
 * open a call there, and a reconnect after it would leave two live.
 *
 * @param recovery what the shell handed over
 * @param steps the posts and the reconnect
 * @param writeId the closed line's id
 * @param instance `e2e` on the desktop test instance, so the closing batch carries its marker like every other
 * @returns what each step did
 */
export async function recoverCrashedCall({
  recovery,
  steps,
  writeId,
  instance,
}: {
  recovery: OverlayCrashRecovery;
  steps: CrashRecoverySteps;
  writeId: string;
  instance: "e2e" | undefined;
}): Promise<CrashRecoveryOutcome> {
  let stop: CrashStop | undefined;
  if (recovery.planCallId !== null) {
    stop = await steps.stopPlan({ callId: recovery.planCallId, why: recovery.why });
  }
  const closed = await steps.closeTranscript({ wire: crashedTranscriptWire({ instance, recovery, writeId }) });
  const stopLanded = stop === undefined || stop.kind === "taken";
  const superseded = steps.superseded();
  const reconnected = recovery.reconnect && stopLanded && !superseded;
  if (reconnected) {
    steps.reconnect();
  }
  return { closed, reconnected, stop, superseded };
}

/**
 * The sentence the page shows for a recovery that did not bring the call back, or `undefined` when it did or when the
 * owner started a call themselves meanwhile. A second crash inside the minute, where the shell said not to reconnect, is named.
 *
 * @param outcome what the recovery did
 * @param recovery what the shell handed over
 * @returns the failure line, or `undefined` for none
 */
export function crashRecoveryFailure({
  outcome,
  recovery,
}: {
  outcome: CrashRecoveryOutcome;
  recovery: OverlayCrashRecovery;
}): string | undefined {
  if (outcome.stop !== undefined && outcome.stop.kind !== "taken") {
    return `the voice window crashed and its call could not be ended, so it did not reconnect: ${outcome.stop.why}`;
  }
  if (outcome.superseded) {
    return undefined;
  }
  if (!recovery.reconnect) {
    return `the voice window crashed twice inside a minute, so it did not reconnect: ${recovery.why}`;
  }
  return undefined;
}
