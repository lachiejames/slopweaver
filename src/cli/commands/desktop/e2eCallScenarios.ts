/**
 * The call scenarios that never crash anything — a call that answers, a call held for minutes, a long task mid-call,
 * and a quit-and-reopen — and the moves every scenario shares. The crash scenarios are `./e2eCallCrashScenarios.ts`,
 * the typed Queue search `./e2eCallQueueSearchScenario.ts`.
 *
 * **Never a press beside a live call.** Every Talk press waits for NO call lease to be live first, and refuses to
 * press when one stays live — whoever's it is — then reads the on-call hold (a lease, or a microphone another app
 * holds) once more at the press itself, and a hold there holds the whole leg. A call the page re-opens by itself, a crash recovery, is the page's own
 * act, never a press.
 */
import { DESKTOP_VOICE_LINK } from "../../../desktop/deepLink.js";
import type { E2eCallDriveSeen } from "../../../desktop/e2eCallOutcome.js";
import type { E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import { turnAndAnswer } from "../../../desktop/e2eCallRows.js";
import { type E2eHeapVerdict, heapPolicyFor, judgeHeapTrend } from "../../../desktop/e2eHeapTrend.js";
import { isOnCallHold } from "../../../desktop/onCallHold.js";
import { untilTranscriptStill } from "./e2eCallAnswerSettle.js";
import { liveLeaseIds } from "./e2eCallEvidenceRead.js";
import { sampleJsHeap } from "./e2eCallInstance.js";
import {
  closeSessionDetails,
  isIdle,
  isLive,
  liveRows,
  openSessionDetails,
  pressTalk,
  runningWork,
  until,
} from "./e2eCallPage.js";
import { type CallSession, quitMidCall, relaunchCallSession, voicePageOf } from "./e2eCallSession.js";
import type { VoiceView } from "./e2eCallView.js";
import { pause } from "./e2ePage.js";
import { readOnCallHold } from "./onCallRead.js";

/** How long a press, or a typed question, waits for every call lease to lapse: a 60s lease, and room. */
export const CLEAR_CAP_MS = 120_000;

/** How often a held call's heap is read. */
const HEAP_EVERY_MS = 10_000;

/** How long the tray must show no work running before the long task is taken as done. */
const WORK_QUIET_MS = 8000;

/** What one scenario's drive saw, before cleanup and the logs are read. */
export interface ScenarioOutcome extends E2eCallDriveSeen {
  readonly heapVerdict: E2eHeapVerdict | undefined;
  /** The voice window to photograph, `undefined` when none showed. */
  readonly view: VoiceView | undefined;
}

/**
 * What a scenario is driven with.
 *
 * @internal
 */
export interface ScenarioInput {
  readonly session: CallSession;
  readonly step: E2eCallStep;
  /** The run's own token, which the typed probe carries. */
  readonly nonce: string;
}

/** A scenario. */
export type Scenario = (input: ScenarioInput) => Promise<ScenarioOutcome>;

/**
 * An outcome that saw nothing yet, to spread a scenario's findings over.
 *
 * @param view the voice window so far
 * @returns the outcome
 */
export function nothingYet({ view }: { view: VoiceView | undefined }): ScenarioOutcome {
  return {
    blocked: undefined,
    crash: undefined,
    dropped: undefined,
    heapVerdict: undefined,
    live: false,
    longTaskMs: undefined,
    overlap: undefined,
    ownerTurn: false,
    queueSearchAnswer: undefined,
    stuck: undefined,
    view,
    voiceAnswer: false,
  };
}

/**
 * Press Talk once no call lease is live.
 *
 * @param view the voice window
 * @param start starts the call in place of the Talk click, every check before it kept (`pressTalk`)
 * @returns `undefined` once pressed, else why it was not
 */
export async function pressWhenClear({
  session,
  start,
  view,
}: {
  session: CallSession;
  start?: () => Promise<void>;
  view: VoiceView;
}): Promise<string | undefined> {
  let problem = "";
  const clear = await until({
    capMs: CLEAR_CAP_MS,
    test: async () => {
      const live = liveLeaseIds({ home: session.spec.home, nowMs: Date.now() });
      problem = live.isErr() ? live.error.message : `call lease(s) live: ${live.value.join(", ")}`;
      return live.isOk() && live.value.length === 0;
    },
  });
  if (!clear) {
    return `no Talk press while a call is up — ${problem}`;
  }
  // The lease read above sees only voice calls; the owner's Zoom holds a microphone instead, and may have picked one up since
  // the launch, so both are read once more at the click itself.
  //
  // What this closes, and what it does not: the wait above RETRIES a lease read that failed, and forgets it once a
  // later one succeeds, as does the call leg's preflight. That is deliberate. The click is decided only by the strict
  // read at the click, which holds on any unreadable or unparseable state, so a failure that has since cleared cannot
  // place a call beside the owner's. A failure that stays failed stops the run, exit 1. Remembering every transient failure
  // would turn one torn heartbeat into a failed run.
  const pressed = await pressTalk({
    interrupted: () => session.interrupted,
    onCall: () => readOnCallHold({ home: session.spec.home }),
    view,
    ...(start === undefined ? {} : { start }),
  });
  if (pressed.isErr() && isOnCallHold(pressed.error)) {
    session.onCallHold = pressed.error;
  }
  return pressed.isErr() ? pressed.error.message : undefined;
}

/**
 * Press Talk and wait for the call to go live.
 *
 * @param view the voice window
 * @param start starts the call in place of the Talk click (`pressTalk`)
 * @returns whether it went live, or why it was not pressed
 */
export async function goLive({
  session,
  start,
  view,
}: {
  session: CallSession;
  start?: () => Promise<void>;
  view: VoiceView;
}): Promise<{ readonly blocked: string | undefined; readonly live: boolean }> {
  const blocked = await pressWhenClear({ session, view, ...(start === undefined ? {} : { start }) });
  if (blocked !== undefined) {
    return { blocked, live: false };
  }
  return {
    blocked: undefined,
    live: await until({ capMs: session.spec.step.capMs, test: async () => isLive({ view }) }),
  };
}

/**
 * Wait for a caller turn and an answer after it on the live call.
 *
 * @param view the voice window
 * @param capMs how long
 * @param ownerText what the owner's turn must contain, `undefined` for any turn of the owner's
 * @returns what was seen by the cap
 */
export async function awaitAnswer({
  view,
  capMs,
  ownerText,
}: {
  view: VoiceView;
  capMs: number;
  ownerText: string | undefined;
}): Promise<{ readonly ownerTurn: boolean; readonly voiceAnswer: boolean }> {
  let seen = { ownerTurn: false, voiceAnswer: false };
  await until({
    capMs,
    test: async () => {
      seen = turnAndAnswer({ ownerText, rows: await liveRows({ view }) });
      return seen.voiceAnswer;
    },
  });
  return seen;
}

/** A scenario's live start: the voice window with its call live, or the outcome to return as it stands. */
export type LiveStart =
  { readonly kind: "live"; readonly view: VoiceView } | { readonly kind: "stopped"; readonly outcome: ScenarioOutcome };

/**
 * Open the session's voice page, press Talk and wait for the call to go live.
 *
 * @param start starts the call in place of the Talk click (`pressTalk`)
 * @returns the live voice window, or the outcome to return
 */
export async function startLive({
  session,
  start,
}: {
  session: CallSession;
  start?: () => Promise<void>;
}): Promise<LiveStart> {
  const opened = await voicePageOf({ session });
  if (opened.isErr()) {
    return { kind: "stopped", outcome: { ...nothingYet({ view: undefined }), blocked: opened.error.message } };
  }
  const started = await goLive({ session, view: opened.value, ...(start === undefined ? {} : { start }) });
  if (!started.live) {
    return { kind: "stopped", outcome: { ...nothingYet({ view: opened.value }), ...started } };
  }
  return { kind: "live", view: opened.value };
}

/**
 * `call-live`: a call goes live, hears the prompt, and answers it.
 *
 * @returns what the call showed, for the judge
 */
export const callLive: Scenario = async ({ session, step }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  return {
    ...nothingYet({ view }),
    live: true,
    ...(await awaitAnswer({ capMs: step.capMs, ownerText: undefined, view })),
  };
};

/**
 * `launcher-voice`: a launcher's `slopweaver://voice` starts the call, goes live, hears a caller turn and answers it.
 * The address is handed to the instance's own `open-url` handler from its main process, exactly as macOS hands it,
 * because a real `open slopweaver://voice` would reach the owner's own app, which holds the scheme (`./e2ePinnedQueue.ts`).
 *
 * @returns what the call showed, for the judge
 */
export const launcherVoice: Scenario = async ({ session, step }) => {
  const emit = async (): Promise<void> => {
    await session.app.evaluate(({ app: shell }, url) => {
      // `src/` has no Electron types; `open-url` is the event `desktop/src/launch.ts` listens on.
      shell.emit("open-url", { preventDefault: () => undefined }, url);
    }, DESKTOP_VOICE_LINK);
  };
  const start = await startLive({ session, start: emit });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  return {
    ...nothingYet({ view }),
    live: true,
    ...(await awaitAnswer({ capMs: step.capMs, ownerText: undefined, view })),
  };
};

/**
 * `call-holds`: a call held live for the hold, its heap read every ten seconds.
 *
 * @returns what the call showed and the heap trend's verdict, for the judge
 */
export const callHolds: Scenario = async ({ session, step }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  const answer = await awaitAnswer({ capMs: step.capMs, ownerText: undefined, view });
  // A fresh instance's voice window is always Playwright's page; without one no sample is taken and the trend fails.
  const { page } = view;
  const sample = async ({ elapsedMs }: { elapsedMs: number }) =>
    page === undefined ? undefined : sampleJsHeap({ app: session.app, elapsedMs, page });
  const began = Date.now();
  let dropped: string | undefined;
  while (Date.now() - began < step.holdMs && dropped === undefined) {
    const one = await sample({ elapsedMs: Date.now() - began });
    if (one !== undefined) {
      session.heapSamples.push(one);
    }
    if (!(await isLive({ view }))) {
      dropped = `the call dropped ${String(Math.round((Date.now() - began) / 1000))}s into the hold`;
    }
    await pause({ ms: HEAP_EVERY_MS });
  }
  // The last pause is part of the hold, so the call is read once more at its end (Codex call-r1-no-false-pass).
  if (dropped === undefined && !(await isLive({ view }))) {
    dropped = `the call dropped in the last ${String(HEAP_EVERY_MS / 1000)}s of the hold`;
  }
  // One reading at or past the hold's end, so its last window is complete rather than cut off by the loop's exit.
  const closing = await sample({ elapsedMs: Date.now() - began });
  if (closing !== undefined && dropped === undefined) {
    session.heapSamples.push(closing);
  }
  const heapVerdict = judgeHeapTrend({ policy: heapPolicyFor({ holdMs: step.holdMs }), samples: session.heapSamples });
  return { ...nothingYet({ view }), ...answer, dropped, heapVerdict, live: true };
};

/**
 * `long-task-mid-call`: the voice runs real work for ten seconds or more mid-call, then answers. The session details
 * tray shows the work and HIDES the transcript while open, so it is closed once the work stops and the answer is read
 * from the transcript then: the voice's last row, after the owner's turn. The call then stays up until the final rows hold
 * still (`./e2eCallAnswerSettle.ts`), best effort, so the whole answer reaches the call file before the hang-up.
 *
 * @returns what the call showed and how long the tray showed work running, for the judge
 */
export const longTaskMidCall: Scenario = async ({ session, step }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  const tray = await openSessionDetails({ view });
  if (tray.isErr()) {
    return { ...nothingYet({ view }), blocked: tray.error.message, live: true };
  }
  const deadline = Date.now() + step.capMs;
  // Every instant the tray showed work running; the long task is the first to the last.
  const runningAt: number[] = [];
  const settled = await until({
    capMs: step.capMs,
    test: async () => {
      const running = await runningWork({ view });
      if (running > 0) {
        runningAt.push(Date.now());
      }
      // Quiet for a while, not for one look: a chain of reads leaves a gap between one ending and the next starting.
      return runningAt.length > 0 && running === 0 && Date.now() - runningAt.at(-1)! >= WORK_QUIET_MS;
    },
  });
  const longTaskMs = runningAt.length === 0 ? undefined : runningAt.at(-1)! - runningAt[0]!;
  // Work seen and never quiet by the cap is a task that never finished, not a long one: an answer read after it would
  // pass a tray stuck on running. No work at all falls through to the long-task check, which names that instead.
  if (!settled && longTaskMs !== undefined) {
    const blocked = `the session details tray still showed work running at the ${String(step.capMs / 1000)}s cap`;
    return { ...nothingYet({ view }), blocked, live: true, longTaskMs };
  }
  const closed = await closeSessionDetails({ view });
  if (closed.isErr()) {
    return { ...nothingYet({ view }), blocked: closed.error.message, live: true, longTaskMs };
  }
  let answer = { ownerTurn: false, voiceAnswer: false };
  await until({
    capMs: Math.max(0, deadline - Date.now()),
    test: async () => {
      const rows = await liveRows({ view });
      const seen = turnAndAnswer({ ownerText: undefined, rows });
      answer = { ownerTurn: seen.ownerTurn, voiceAnswer: seen.voiceAnswer && rows.at(-1)?.who === "voice" };
      return answer.voiceAnswer;
    },
  });
  if (answer.voiceAnswer) {
    await untilTranscriptStill({ capMs: Math.max(0, deadline - Date.now()), view });
  }
  return { ...nothingYet({ view }), ...answer, live: true, longTaskMs };
};

/**
 * `relaunch`: a live call, the app quit mid-call; the console ends what it left; the app reopened over the same state
 * starts nothing by itself, and exactly one new call goes live on a press.
 *
 * @returns what both launches showed, for the judge
 */
export const relaunch: Scenario = async ({ session }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  await awaitAnswer({ capMs: 30_000, ownerText: undefined, view: start.view });
  const stuck = await quitMidCall({ session });
  if (stuck !== undefined) {
    return { ...nothingYet({ view: undefined }), live: true, stuck };
  }
  const opened = session.tracker.planCallIds.length;
  const relaunched = await relaunchCallSession({ session });
  if (relaunched.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: relaunched.error.message, live: true };
  }
  const again = await voicePageOf({ session });
  if (again.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: again.error.message, live: true };
  }
  const view = again.value;
  await pause({ ms: 5000 });
  if (!(await isIdle({ view })) || session.tracker.planCallIds.length !== opened) {
    return { ...nothingYet({ view }), live: true, overlap: "the reopened app started a call nobody pressed Talk for" };
  }
  const second = await goLive({ session, view });
  if (second.live && session.tracker.planCallIds.length !== opened + 1) {
    const count = String(session.tracker.planCallIds.length - opened);
    return { ...nothingYet({ view }), live: true, overlap: `one press opened ${count} plan calls` };
  }
  return { ...nothingYet({ view }), ...second };
};
