/**
 * The call leg of `slopweaver desktop e2e --call`: real voice calls on a visible test instance, one fresh instance per
 * scenario (`relaunch` reopens its own), each judged over what its page showed and what the console, the call store
 * and the desktop shell wrote. The scenarios are `./e2eCallScenarios.ts`, `./e2eCallCrashScenarios.ts`,
 * `./e2eCallQueueSearchScenario.ts` and `./e2eCallCardReadScenario.ts`; the
 * instance's life and its cleanup are `./e2eCallSession.ts`.
 *
 * **One leg at a time, and never beside a live call.** The leg holds an operation lock for its whole run, so two seats
 * cannot place calls at once, and before each scenario it reads every console's call leases AND the target console's
 * call registry: a live lease — the owner's call, another checkout's, a mint still connecting — or a microphone another app
 * holds is refused at once (`../../../desktop/onCallHold.ts`), and a held voice call, or a typed conversation not yet
 * at rest, is waited out, then refused. A typed conversation at rest it runs beside, untouched — except before a scenario
 * that types into the messenger, which waits on every held conversation, since a typed one it opens replaces them
 * (`../../../desktop/heldConversations.ts` `besideAtRestFor`). Any lease unreadable fails closed at once; a registry
 * unreadable (a rebuild swapping the server) is waited on, then refused. The console refuses the test instance's
 * offer beside anything but a typed conversation at rest too (`site/lib/talkArbiter.ts`), closing the gap between the
 * read and the call. A
 * call the owner opens in ANOTHER console after the last read is not prevented — the reads are snapshots, never a lock their
 * consoles take — so the shared call store is read again after every scenario, and a call it did not place that was
 * open while the scenario ran stops the leg (`./e2eCallLegPlan.ts` `stopAfter`). A scenario whose calls cannot be
 * proven ended stops the leg too: the report keeps what ran, and `fatal` says why.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { openedPlanCalls } from "../../../desktop/e2eCallEvidence.js";
import { judgeCallScenario, NO_CALL_EVIDENCE, observedOf } from "../../../desktop/e2eCallOutcome.js";
import type { E2eCallStep, E2eCallStepId } from "../../../desktop/e2eCallPlan.js";
import { planCallOverlap } from "../../../desktop/e2eCallRequirements.js";
import { foreignCallWaitMs, legLockStaleMs } from "../../../desktop/e2eCardInventory.js";
import type { E2eCardStepId } from "../../../desktop/e2eCardReadPlan.js";
import { failed } from "../../../desktop/e2eOutcome.js";
import type { E2eStepResult } from "../../../desktop/e2eReport.js";
import type { E2eTranscriptFidelityTrial } from "../../../desktop/e2eTranscriptFidelityReport.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import { besideAtRestFor } from "../../../desktop/heldConversations.js";
import { heldOnCall, isOnCallHold, type OnCallHoldError } from "../../../desktop/onCallHold.js";
import { disarmReopenProbe } from "../../../talk/e2eReopenProbe.js";
import { cardNextDrive } from "./e2eCallCardNextScenario.js";
import { cardReadingHoldDrive } from "./e2eCallCardReadingHoldScenario.js";
import { cardRead } from "./e2eCallCardReadScenario.js";
import { cardReadTyped } from "./e2eCallCardReadTypedScenario.js";
import {
  rendererKilled,
  rendererKilledConnecting,
  rendererKilledTwice,
  typingAfterDrop,
} from "./e2eCallCrashScenarios.js";
import { evidenceOf } from "./e2eCallEvidenceCollect.js";
import { plannedSteps, preflight, stopAfter } from "./e2eCallLegPlan.js";
import { queueSearch } from "./e2eCallQueueSearchScenario.js";
import { callReopen } from "./e2eCallReopenScenario.js";
import {
  callHolds,
  callLive,
  launcherVoice,
  longTaskMidCall,
  nothingYet,
  relaunch,
  type Scenario,
  type ScenarioOutcome,
} from "./e2eCallScenarios.js";
import { type CallSession, closeCallSession, openCallSession } from "./e2eCallSession.js";
import { signalGuarded, signalListeners } from "./e2eCallSignals.js";
import { updateSwapResume } from "./e2eCallUpdateSwapScenario.js";
import { contentsView, pageView } from "./e2eCallView.js";
import { draftReadBack } from "./e2eDraftReadBackScenario.js";
import { shotPathOf } from "./e2eDriver.js";
import { transcriptionFidelity } from "./e2eTranscriptFidelityScenario.js";
import { fidelityTrialOf } from "./e2eTranscriptFidelityTrial.js";

/** The lock two call legs sharing a home contend for. */
const CALL_LOCK_KEY = "desktop-e2e-call";

/** Each scenario's drive. */
const SCENARIOS: Readonly<Record<E2eCallStepId, Scenario>> = {
  "call-holds": callHolds,
  "call-live": callLive,
  "card-next": cardNextDrive,
  "card-read": cardRead,
  "card-read-typed": cardReadTyped,
  "card-reading-hold": cardReadingHoldDrive,
  // A draft read back asks for no long task: two lines may be drafted in seconds.
  "draft-read-back": draftReadBack,
  // The long task's drive: real work, then the voice's answer read once it goes quiet.
  "fleet-ask": longTaskMidCall,
  "launcher-voice": launcherVoice,
  "long-task-mid-call": longTaskMidCall,
  "queue-search": queueSearch,
  relaunch,
  "renderer-killed": rendererKilled,
  "renderer-killed-connecting": rendererKilledConnecting,
  "renderer-killed-twice": rendererKilledTwice,
  "transcription-fidelity": transcriptionFidelity,
  "typing-after-drop": typingAfterDrop,
  "update-swap-resume": updateSwapResume,
  // Three calls, A then two reopens, the reminder window armed for them alone.
  "call-reopen": callReopen,
};

/**
 * The drive one scenario runs.
 *
 * @param id the scenario
 * @returns its drive
 */
export function scenarioFor({ id }: { id: E2eCallStepId }): Scenario {
  return SCENARIOS[id];
}

/** What the leg needs from the verb. */
export interface E2eCallLegOptions {
  readonly app: string;
  readonly checkout: string;
  /** Every checkout whose console may hold a call of the owner's: the target and each main checkout the owner declares. */
  readonly consoles: readonly string[];
  readonly home: string;
  /** Whether each scenario's instance draws its own Slopweaver Test menu bar icon (`--menu-bar`). */
  readonly menuBar: boolean;
  /** The work context every instance's console is put in before a call (`--context`); `undefined` leaves it as it opened. */
  readonly context: E2eWorkContext | undefined;
  readonly out: string;
  readonly steps: readonly E2eCallStep[];
  /** With `--call-card all`, the card scenarios each card the console draws is asked, placed once it is read. */
  readonly inventorySurfaces: readonly E2eCardStepId[];
  /** The photographs' numbering continues from the walk's. */
  readonly firstIndex: number;
  /** The run's own token, which the typed probe carries. */
  readonly nonce: string;
  readonly progress: (options: { readonly result: E2eStepResult }) => void;
  /** A line about the leg itself, such as the inventory it read. */
  readonly note: (options: { readonly line: string }) => void;
}

/** What the leg ran, and why it stopped early when it did. */
export interface E2eCallLegResult {
  readonly results: readonly E2eStepResult[];
  readonly fatal: string | undefined;
  /** Whether `fatal` is a call seen before a scenario — a hold, exit 4 — rather than a fault. */
  readonly heldOnCall: boolean;
  /** Every `transcription-fidelity` call's trial, in the order they ran; empty when none ran. */
  readonly fidelityTrials: readonly E2eTranscriptFidelityTrial[];
}

/**
 * Photograph what the scenario ended on: its voice window, else the voice window's web contents, else any page
 * still open — the first that can be taken.
 *
 * @param session the session
 * @param outcome what its drive saw
 * @param shot where the photograph goes
 * @returns the photograph's path and the address it shows, both `undefined` when none could be taken
 */
async function photographed({
  session,
  outcome,
  shot,
}: {
  session: CallSession;
  outcome: ScenarioOutcome;
  shot: string;
}): Promise<{ readonly screenshot: string | undefined; readonly url: string | undefined }> {
  const open = session.app
    .context()
    .pages()
    .filter((page) => !page.isClosed())
    .map((page) => pageView({ page }));
  const scenarios = outcome.view === undefined ? [] : [outcome.view];
  for (const view of [...scenarios, contentsView({ app: session.app }), ...open]) {
    const screenshot = await view.photograph({ path: shot });
    if (screenshot !== undefined) {
      return { screenshot, url: await view.url() };
    }
  }
  return { screenshot: undefined, url: undefined };
}

/**
 * Drive one scenario over an open session, photograph it, clean up, and judge it.
 *
 * @param session the session
 * @param step the scenario
 * @param nonce the run's token
 * @param shot where its photograph goes
 * @returns its result, and whether its cleanup failed
 */
async function driveOpened({
  session,
  step,
  nonce,
  shot,
}: {
  session: CallSession;
  step: E2eCallStep;
  nonce: string;
  shot: string;
}): Promise<{
  readonly result: Omit<E2eStepResult, "elapsedMs">;
  readonly cleanup: string | undefined;
  readonly trial: E2eTranscriptFidelityTrial | undefined;
}> {
  const outcome = await scenarioFor({ id: step.id })({ nonce, session, step }).catch(
    (cause: unknown): ScenarioOutcome => ({
      ...nothingYet({ view: undefined }),
      blocked: `the drive threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    }),
  );
  // A photograph that throws is none; the session is closed whatever it did (Codex call-r2-cleanup).
  const { screenshot, url } = await photographed({ outcome, session, shot }).catch(() => ({
    screenshot: undefined,
    url: undefined,
  }));
  const closed = await closeCallSession({ session });
  const { evidence, unread } = evidenceOf({ nonce, outcome, session });
  const counted = planCallOverlap({ id: step.id, opened: openedPlanCalls({ events: evidence.planEvents }) });
  const observed = observedOf({ closed, counted, evidence, seen: outcome, unread });
  const verdict = judgeCallScenario({ id: step.id, observed });
  return {
    cleanup: observed.cleanup,
    result: { call: evidence, screenshot, step, url, verdict },
    // Read only once the cleanup proved every call ended, so the call file is whole; else the trial says it is not.
    // The verdict goes in too: a call that dropped mid-script is partial, never scored.
    trial: fidelityTrialOf({ session, transcriptCallIds: evidence.transcriptCallIds, verdict }),
  };
}

/**
 * Why the leg stops when a scenario's calls could not be proven ended. That outranks a hold the scenario met — a call
 * not proven ended keeps the lock — but the hold is still named: the owner's own call's lease is what keeps the global count
 * above zero, so a cleanup that waited it out would otherwise read as a fault of the test's.
 *
 * @param cleanup what the cleanup could not prove
 * @param hold the hold the scenario stopped on, `undefined` when it met none
 * @returns the fatal line
 */
export function cleanupFatal({ cleanup, hold }: { cleanup: string; hold: OnCallHoldError | undefined }): string {
  const unproven = E2eCallErrors.cleanupFailed({ detail: cleanup }).message;
  if (hold === undefined) {
    return unproven;
  }
  return `${unproven} — the scenario had already held on the owner's call (${hold.code}): ${hold.message}`;
}

/**
 * One scenario, from its microphone to its judgement.
 *
 * @param options the leg's options
 * @param step the scenario
 * @param index its place in the run, from zero
 * @returns its result, and why the leg must stop when it must — or the hold, when the owner was on a call at the launch or
 *   at a Talk press, and no test call was placed
 */
async function runScenario({
  options,
  step,
  index,
}: {
  options: E2eCallLegOptions;
  step: E2eCallStep;
  index: number;
}): Promise<
  | { readonly kind: "held"; readonly hold: OnCallHoldError }
  | {
      readonly kind: "ran";
      readonly result: E2eStepResult;
      readonly fatal: string | undefined;
      readonly trial: E2eTranscriptFidelityTrial | undefined;
    }
> {
  const started = Date.now();
  const scratch = mkdtempSync(join(tmpdir(), "sw-e2e-call-"));
  try {
    const spec = {
      app: options.app,
      checkout: options.checkout,
      context: options.context,
      home: options.home,
      menuBar: options.menuBar,
      scratch,
      step,
    };
    // Read before the launch adds Playwright's own, so the guard hands back only these.
    const beforeLaunch = signalListeners();
    const opened = await openCallSession({ spec });
    if (opened.isErr() && isOnCallHold(opened.error)) {
      return { hold: opened.error, kind: "held" };
    }
    if (opened.isErr()) {
      const verdict = failed({ detail: opened.error.message, kind: "blocked" });
      const result = { call: NO_CALL_EVIDENCE, elapsedMs: Date.now() - started, screenshot: undefined, step };
      return { fatal: undefined, kind: "ran", result: { ...result, url: undefined, verdict }, trial: undefined };
    }
    const session = opened.value;
    const shot = shotPathOf({ id: step.id, index, out: options.out });
    const driven = await signalGuarded({
      beforeLaunch,
      drive: async () => driveOpened({ nonce: options.nonce, session, shot, step }),
      scratch,
      session,
    });
    // A cleanup that failed outranks the hold: a call not proven ended keeps the lock (below).
    if (driven.cleanup === undefined && session.onCallHold !== undefined) {
      return { hold: session.onCallHold, kind: "held" };
    }
    const fatal =
      driven.cleanup === undefined ? undefined : cleanupFatal({ cleanup: driven.cleanup, hold: session.onCallHold });
    return { fatal, kind: "ran", result: { ...driven.result, elapsedMs: Date.now() - started }, trial: driven.trial };
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * Run the call leg: the lock, then each scenario behind its preflight, stopping at the first that cannot be proven
 * clean.
 *
 * @param options the bundle, the checkout, the folders and the scenarios
 * @returns every scenario that ran, and why the leg stopped early when it did
 */
export async function driveCallLeg(options: E2eCallLegOptions): Promise<E2eCallLegResult> {
  const inventory = options.inventorySurfaces.length > 0;
  if (options.steps.length === 0 && !inventory) {
    return { fatal: undefined, heldOnCall: false, fidelityTrials: [], results: [] };
  }
  const lock = acquireOperationLock({
    home: options.home,
    key: CALL_LOCK_KEY,
    nowIso: new Date().toISOString(),
    staleAfterMs: legLockStaleMs({ inventory, steps: options.steps }),
  });
  if (lock.isErr()) {
    return {
      fatal: E2eCallErrors.callLockHeld({ detail: lock.error }).message,
      heldOnCall: false,
      fidelityTrials: [],
      results: [],
    };
  }
  const release = (): void => {
    lock.value.release();
  };
  const waitMs = foreignCallWaitMs({ inventory, steps: options.steps });
  const planned = await plannedSteps({ options, waitMs });
  if (planned.isErr()) {
    release();
    return {
      fatal: planned.error.message,
      heldOnCall: heldOnCall({ code: planned.error.code }),
      fidelityTrials: [],
      results: [],
    };
  }
  return walkPlanned({ options, release, steps: planned.value, waitMs });
}

/** The planned scenarios in order, each behind its preflight, releasing the call lock on every way out. */
async function walkPlanned({
  options,
  release,
  steps,
  waitMs,
}: {
  options: E2eCallLegOptions;
  release: () => void;
  steps: readonly E2eCallStep[];
  waitMs: number;
}): Promise<E2eCallLegResult> {
  const results: E2eStepResult[] = [];
  const fidelityTrials: E2eTranscriptFidelityTrial[] = [];
  for (const [offset, step] of steps.entries()) {
    // Before EVERY scenario, not once per leg: a `call-reopen` killed before its own `finally` leaves its arm file
    // behind, and its writer's pid can be reused or linger as a zombie, while one
    // whose closing removal failed leaves it armed under this very run's pid for the scenario after it.
    // Only one leg holds this lock, so removing any arm file here closes the window for every
    // scenario but the one that arms it again, and a probe still readable after that stops the leg before any call.
    const disarmed = disarmReopenProbe({ home: options.home });
    if (disarmed.isErr()) {
      release();
      return { fatal: disarmed.error.message, heldOnCall: false, fidelityTrials, results };
    }
    const fromMs = Date.now();
    const placed = results.flatMap((done) => (done.call === undefined ? [] : done.call.transcriptCallIds));
    const refused = await preflight({ besideAtRest: besideAtRestFor({ id: step.id }), leg: options, placed, waitMs });
    if (refused !== undefined) {
      release();
      return { fatal: refused.message, heldOnCall: heldOnCall({ code: refused.code }), fidelityTrials, results };
    }
    const ran = await runScenario({ index: options.firstIndex + offset, options, step });
    if (ran.kind === "held") {
      release();
      return { fatal: ran.hold.message, heldOnCall: heldOnCall({ code: ran.hold.code }), fidelityTrials, results };
    }
    const { result, fatal, trial } = ran;
    if (trial !== undefined) {
      fidelityTrials.push(trial);
    }
    results.push(result);
    options.progress({ result });
    const stop = stopAfter({ fatal, fromMs, home: options.home, placed, release, result });
    if (stop !== undefined) {
      return { fatal: stop, heldOnCall: false, fidelityTrials, results };
    }
  }
  release();
  return { fatal: undefined, heldOnCall: false, fidelityTrials, results };
}
