/**
 * The call's half of the one-click update: end the voice call for an update, saving first that it is owed a restart,
 * and restart it once the update's step is taken — the one way every step reaches it. The rest of the update is
 * `updateShell.ts`; the decisions are `updatePlan.ts`.
 */
import { err, ok, type Result } from "neverthrow";

import { logDesktopEvent } from "./eventLogShell";
import { withUpdateFields } from "./persistedState";
import { type ResumeLogDecision, resumeDecision, resumeLogDecision, type UpdateFieldsChange } from "./updatePlan";
import type { UpdateShellHost } from "./updateShellHost";

/** How long the shell waits for an ended call to let go before it says it could not end it. */
const HANG_UP_WAIT_MS = 10_000;

/** How often it looks while waiting. */
const HANG_UP_POLL_MS = 250;

/**
 * How long after a call is ended for an update the shell waits for the page's next step — an update launched, a
 * reload, a relaunch — before it restarts the call itself. Past the longest wait a step takes (a held build's swap,
 * `SWAP_WAIT_MS` in `updatePlan.ts`, 3 minutes), so it only fires when the page went away mid-press.
 */
const ORPHANED_END_MS = 4 * 60_000;

/** How often the shell looks again at a call owed a restart that it could not hand over yet. */
const RESUME_RETRY_MS = 1_000;

/** What the call's half reads from the rest of the update shell. */
interface UpdateCallContext {
  readonly host: UpdateShellHost;
  /** Whether this process may launch the update itself — the owner's app only; a test instance's log lines say `e2e`. */
  readonly installAllowed: boolean;
  /** Whether an update this app launched is still being waited on, so the orphan timer leaves its restart to it. */
  readonly updateRunning: () => boolean;
}

let context: UpdateCallContext | undefined;
/** The restart armed by the last call ended for an update, in case the page goes away before its next step. */
let orphanTimer: NodeJS.Timeout | undefined;
/** The next look at a call owed a restart that could not be handed over yet. */
let resumeTimer: NodeJS.Timeout | undefined;
/** How many of the hang-ups it asked for the shell is still waiting on, the call being ended still reading live. */
let hangUpsInFlight = 0;
/** How many times a call was asked to end for an update, so an earlier press never drops a later one's restart. */
let endPresses = 0;
/** The last restart decision logged, so the log says each change once rather than every look. */
let lastResumeLog: { readonly sinceIso: string; readonly decision: ResumeLogDecision } | undefined;

/**
 * Hand the call's half the rest of the shell, before any step can reach it.
 *
 * @param callContext the host, whether installs are allowed, and whether an update is being waited on
 */
export function startUpdateCall({ callContext }: { callContext: UpdateCallContext }): void {
  context = callContext;
}

/**
 * Save, or clear, the update's two saved fields at once.
 *
 * @param change the fields to set, a `null` clearing one
 */
export function rememberUpdate({ change }: { change: UpdateFieldsChange }): void {
  if (context !== undefined) {
    context.host.persist(withUpdateFields({ change, state: context.host.saved() }));
  }
}

/** Why the shell could not end a call for an update. */
type EndCallRefusal = "RUNNING" | "CALL_IN_CONSOLE_WINDOW" | "NOT_LISTENING" | "DID_NOT_END";

/**
 * End the voice call for an update, saving that it is owed a restart first. No call is no work.
 *
 * @returns whether a call was ended, or why it could not be
 */
export async function endCallForUpdate(): Promise<Result<{ readonly ended: boolean }, EndCallRefusal>> {
  const host = context?.host;
  if (host === undefined || !host.callLive()) {
    return ok({ ended: false });
  }
  // The launch that would follow is refused while one runs, and the orphan timer leaves a restart to that update, so
  // a call ended now would wait on an update it was never ended for.
  if (context?.updateRunning() === true) {
    return err("RUNNING");
  }
  if (host.consoleWindowHoldsMic()) {
    return err("CALL_IN_CONSOLE_WINDOW");
  }
  const overlayPage = host.listeningOverlay();
  if (overlayPage === undefined) {
    return err("NOT_LISTENING");
  }
  // A look still pending from an earlier ended call would hand this one its start before the update's step is taken.
  clearTimeout(resumeTimer);
  resumeTimer = undefined;
  rememberUpdate({ change: { resumeVoice: { sinceIso: new Date().toISOString() } } });
  // A page that goes away between this and its next step would leave the call ended for nothing. One
  // timer at a time: an earlier press's, left armed, took a later press's restart early, and the later step then
  // ended the restarted call with nothing left owed — matching the saved instant could not tell two presses apart
  // once the clock moved back.
  clearTimeout(orphanTimer);
  orphanTimer = setTimeout(() => {
    orphanTimer = undefined;
    if (context?.updateRunning() === false) {
      resumeIfOwed();
    }
  }, ORPHANED_END_MS);
  endPresses += 1;
  const press = endPresses;
  hangUpsInFlight += 1;
  try {
    overlayPage.send("slopweaver:overlay-command", "hang-up");
    for (let waited = 0; waited < HANG_UP_WAIT_MS; waited += HANG_UP_POLL_MS) {
      if (!host.callLive()) {
        return ok({ ended: true });
      }
      await new Promise((resolve) => setTimeout(resolve, HANG_UP_POLL_MS));
    }
    if (!host.callLive()) {
      return ok({ ended: true });
    }
  } finally {
    hangUpsInFlight -= 1;
  }
  // Only the latest press's restart is this one's to drop: a later press saved its own and is still waiting on its
  // hang-up.
  if (press === endPresses) {
    rememberUpdate({ change: { resumeVoice: null } });
  }
  return err("DID_NOT_END");
}

/**
 * Restart a call ended for an update, the one way every step reaches it — a settled update, a failed launch, a boot
 * after a relaunch, a reload, a swap, the orphan timer. The flag is cleared only once the start has been sent to a
 * voice page that is listening, or there is nothing left to restart (`resumeDecision`); until then it stays saved and
 * the shell looks again every {@link RESUME_RETRY_MS}. Clearing it first lost the restart whenever the page was not
 * there to hear it. A crash between the send and the write may restart once more,
 * and the page refuses a start with a call already up.
 */
export function resumeIfOwed(): void {
  clearTimeout(resumeTimer);
  resumeTimer = undefined;
  const host = context?.host;
  const resume = host?.saved().resumeVoice;
  if (host === undefined || resume === undefined) {
    return;
  }
  host.ensureOverlay();
  const page = host.listeningOverlay();
  const listening = page !== undefined && !page.isDestroyed();
  const decision = resumeDecision({
    callLive: host.callLive(),
    hangingUp: hangUpsInFlight > 0,
    nowMs: Date.now(),
    overlayListening: listening,
    resume,
  });
  if (decision.kind === "hand" && page !== undefined) {
    try {
      page.send("slopweaver:overlay-command", "activate");
    } catch {
      logResume({ decision: "retry-send-failed", sinceIso: resume.sinceIso });
      resumeTimer = setTimeout(resumeIfOwed, RESUME_RETRY_MS);
      return;
    }
  }
  logResume({ decision: resumeLogDecision({ decision }), sinceIso: resume.sinceIso });
  if (decision.kind === "retry") {
    resumeTimer = setTimeout(resumeIfOwed, RESUME_RETRY_MS);
    return;
  }
  clearTimeout(orphanTimer);
  orphanTimer = undefined;
  rememberUpdate({ change: { resumeVoice: null } });
}

/** Log a restart decision, once per change for the same ended call. */
function logResume({ sinceIso, decision }: { sinceIso: string; decision: ResumeLogDecision }): void {
  if (lastResumeLog?.sinceIso === sinceIso && lastResumeLog.decision === decision) {
    return;
  }
  lastResumeLog = { decision, sinceIso };
  // The log is shared with every test instance; the update half runs in a test instance only with installs refused
  // (`e2eMode.ts`), so that is what names one here.
  const instance = context?.installAllowed === true ? "own" : "e2e";
  logDesktopEvent({
    entry: { atIso: new Date().toISOString(), decision, instance, kind: "update-resume", sinceIso },
  });
}
