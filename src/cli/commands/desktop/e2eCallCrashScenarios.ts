/**
 * The call scenarios that crash the voice window's renderer: one crash that recovers, the same with a
 * typed turn into the recovered call, a second crash inside the settle window, and a crash while still connecting.
 *
 * The crash is judged AFTER cleanup, over the evidence read then (`../../../desktop/e2eCallCrash.ts`), because the
 * console's end lines and the transcript's crash sentence land only once the dead call is ended. Which transcript a
 * crash killed is read from the shell's own `renderer-gone` entry, matched by the plan call id the leg captured. The
 * reloaded page is driven through the window's web contents, since Playwright's page stays crashed
 * (`./e2eCallView.ts`).
 */
import {
  type E2eCrashedCall,
  judgeConnectingCrash,
  judgeCrashEvidence,
  judgeSecondCrash,
} from "../../../desktop/e2eCallCrash.js";
import { openedPlanCalls } from "../../../desktop/e2eCallEvidence.js";
import type { E2eCallEvidence } from "../../../desktop/e2eCallOutcome.js";
import { typedProbe } from "../../../desktop/e2eCallPlan.js";
import { transcriptEnd } from "./e2eCallEvidenceRead.js";
import { crashVoiceRenderer, recoveredVoiceView } from "./e2eCallInstance.js";
import { isConnecting, isLive, typeIntoCall, until } from "./e2eCallPage.js";
import {
  awaitAnswer,
  goLive,
  nothingYet,
  pressWhenClear,
  type Scenario,
  type ScenarioOutcome,
  startLive,
} from "./e2eCallScenarios.js";
import { type CallSession, readCallLogs, voicePageOf } from "./e2eCallSession.js";
import type { VoiceView } from "./e2eCallView.js";
import { pause } from "./e2ePage.js";
import { readOnCallHold } from "./onCallRead.js";

/** How long the reloaded voice page has to answer after a crash. */
const RELOAD_CAP_MS = 60_000;

/** How long a recovered call must stay live after it first shows live; well inside the 60s settle window. */
const RECOVERED_HOLD_MS = 10_000;

/**
 * The call a crash killed, its transcript id read from the shell's death entry for its plan call.
 *
 * @param session the session, for the transcript's end
 * @param evidence the scenario's evidence after cleanup
 * @param planCallId the plan call the crash killed
 * @returns the call, with an empty transcript id when no death entry named it — which the judge then fails
 */
function crashedCall({
  session,
  evidence,
  planCallId,
}: {
  session: CallSession;
  evidence: E2eCallEvidence;
  planCallId: string;
}): E2eCrashedCall {
  const gone = evidence.desktopEvents.find(
    (event) => event.kind === "renderer-gone" && event.call?.planCallId === planCallId,
  );
  if (gone?.kind !== "renderer-gone" || gone.call === null) {
    return { ended: undefined, planCallId, transcriptCallId: "" };
  }
  const transcriptCallId = gone.call.transcriptCallId;
  const end = transcriptEnd({ callId: transcriptCallId, home: session.spec.home });
  return { ended: end.isOk() ? end.value : undefined, planCallId, transcriptCallId };
}

/**
 * The plan calls the session opened, in order: the console log's open lines first, then any the page's answers
 * showed that the log has not written yet. The log is the one that sees a recovered page's call — Playwright cannot
 * read an answer body from a renderer it lost to a crash (measured: the successor's open line was in the
 * log while the tracker held only the crashed call; reproduce with `--call --only renderer-killed` and compare
 * `report.json`'s `planCallIds` with its `planEvents`).
 *
 * @param session the session
 * @returns the ids, first opened first
 */
function openedPlanIds({ session }: { session: CallSession }): readonly string[] {
  const logs = readCallLogs({ session });
  const logged = logs.isOk() ? openedPlanCalls({ events: logs.value.planEvents }) : [];
  return [...new Set([...logged, ...session.tracker.planCallIds])];
}

/**
 * The plan call the session opened at a count, once it has opened that many.
 *
 * @param session the session
 * @param count which, from one
 * @returns its id, or `undefined` when the count was not reached
 */
async function planCallNumber({
  session,
  count,
}: {
  session: CallSession;
  count: number;
}): Promise<string | undefined> {
  let ids: readonly string[] = [];
  await until({
    capMs: 10_000,
    test: async () => {
      ids = openedPlanIds({ session });
      return ids.length >= count;
    },
  });
  return ids[count - 1];
}

/**
 * The whole on-call hold read before EVERY renderer crash, recorded on the session when present. A crash's reloaded
 * page may place a call with no Talk press — a recovery by design, or a reconnect a candidate should not make — so no
 * press gate reads the owner first. The test's own calls hold leases the leases cannot tell from the owner's, and
 * a crashed call's lease outlives its renderer by up to `CALL_LEASE_MS`, so the read allows one lease per test call
 * the scenario has placed; one more live lease, a torn one or a microphone in use holds.
 *
 * @param ownLiveCalls the test calls the scenario has placed whose leases may still be live
 * @returns the hold's message, `undefined` when the owner is not on a call
 */
function heldBeforeCrash({
  session,
  ownLiveCalls,
}: {
  session: CallSession;
  ownLiveCalls: number;
}): string | undefined {
  const onCall = readOnCallHold({ home: session.spec.home, ownLiveCalls });
  if (onCall === undefined) {
    return undefined;
  }
  // Noted on the session so the leg HOLDS once the calls already placed are proven ended, as a relaunch does.
  session.onCallHold = onCall;
  return onCall.message;
}

/** A crash that recovered, or the outcome to return as it stands. */
type Recovery =
  | { readonly kind: "recovered"; readonly view: VoiceView; readonly crashedPlanCallId: string }
  | { readonly kind: "stopped"; readonly outcome: ScenarioOutcome };

/**
 * Crash the live call's renderer and wait for the reloaded page's call to go live again.
 *
 * @param session the session
 * @param view the voice window whose call is live
 * @param count the plan calls the session has opened, the crashed one included
 * @returns the recovered voice window and the crashed call's id, or why it stopped
 */
async function crashAndRecover({
  session,
  view,
  count,
}: {
  session: CallSession;
  view: VoiceView;
  count: number;
}): Promise<Recovery> {
  const crashedPlanCallId = await planCallNumber({ count, session });
  if (crashedPlanCallId === undefined) {
    return {
      kind: "stopped",
      outcome: { ...nothingYet({ view }), blocked: "the live call's plan id was never seen", live: true },
    };
  }
  const onCall = heldBeforeCrash({ ownLiveCalls: 1, session });
  if (onCall !== undefined) {
    return { kind: "stopped", outcome: { ...nothingYet({ view }), blocked: onCall, live: true } };
  }
  const crashed = await crashVoiceRenderer({ app: session.app });
  if (crashed.isErr()) {
    return { kind: "stopped", outcome: { ...nothingYet({ view }), blocked: crashed.error.message, live: true } };
  }
  await pause({ ms: 2000 });
  const reloaded = await recoveredVoiceView({ app: session.app, capMs: RELOAD_CAP_MS });
  if (reloaded === undefined) {
    return {
      kind: "stopped",
      outcome: { ...nothingYet({ view: undefined }), dropped: "the voice page never came back", live: true },
    };
  }
  if (!(await until({ capMs: session.spec.step.capMs, test: async () => isLive({ view: reloaded }) }))) {
    const dropped = "the recovered call never went live";
    return { kind: "stopped", outcome: { ...nothingYet({ view: reloaded }), dropped, live: true } };
  }
  // Live once is not recovered: it must still be live a while later, not a flash before it falls over.
  await pause({ ms: RECOVERED_HOLD_MS });
  if (!(await isLive({ view: reloaded }))) {
    const dropped = `the recovered call dropped within ${String(RECOVERED_HOLD_MS / 1000)}s of going live`;
    return { kind: "stopped", outcome: { ...nothingYet({ view: reloaded }), dropped, live: true } };
  }
  return { crashedPlanCallId, kind: "recovered", view: reloaded };
}

/**
 * Start a live call and wait for a turn of the owner's, so the call the crash kills has a transcript.
 *
 * @param session the session
 * @returns the live voice window, or the outcome to return
 */
async function liveWithTurn({ session }: { session: CallSession }): ReturnType<typeof startLive> {
  const start = await startLive({ session });
  if (start.kind === "live") {
    await awaitAnswer({ capMs: session.spec.step.capMs, ownerText: undefined, view: start.view });
  }
  return start;
}

/**
 * `renderer-killed`: a live call's renderer crashes; the reloaded page reconnects exactly once.
 *
 * @returns what the recovered call showed, with its crash judge
 */
export const rendererKilled: Scenario = async ({ session }) => {
  const start = await liveWithTurn({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const recovery = await crashAndRecover({ count: 1, session, view: start.view });
  if (recovery.kind === "stopped") {
    return recovery.outcome;
  }
  const planCallId = recovery.crashedPlanCallId;
  return {
    ...nothingYet({ view: recovery.view }),
    crash: ({ evidence }) => judgeCrashEvidence({ call: crashedCall({ evidence, planCallId, session }), evidence }),
    live: true,
  };
};

/**
 * `typing-after-drop`: the same recovery, then a typed turn into the recovered call, answered.
 *
 * @returns what the recovered call showed after the typed turn, with its crash judge
 */
export const typingAfterDrop: Scenario = async ({ session, nonce, step }) => {
  const start = await liveWithTurn({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const recovery = await crashAndRecover({ count: 1, session, view: start.view });
  if (recovery.kind === "stopped") {
    return recovery.outcome;
  }
  const { view, crashedPlanCallId: planCallId } = recovery;
  const crash: ScenarioOutcome["crash"] = ({ evidence }) =>
    judgeCrashEvidence({ call: crashedCall({ evidence, planCallId, session }), evidence });
  const typed = await typeIntoCall({ text: typedProbe({ nonce }), view });
  if (typed.isErr()) {
    return { ...nothingYet({ view }), blocked: typed.error.message, crash, live: true };
  }
  const answer = await awaitAnswer({ capMs: step.capMs, ownerText: `E2E typed ${nonce}`, view });
  const dropped = (await isLive({ view })) ? undefined : "the recovered call was not live after the typed turn";
  return { ...nothingYet({ view }), ...answer, crash, dropped, live: true };
};

/**
 * `renderer-killed-twice`: the recovered call crashes too, inside the settle window, and is NOT reconnected.
 *
 * @returns what the page showed after the second crash, with its crash judge
 */
export const rendererKilledTwice: Scenario = async ({ session }) => {
  const start = await liveWithTurn({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const first = await crashAndRecover({ count: 1, session, view: start.view });
  if (first.kind === "stopped") {
    return first.outcome;
  }
  const secondPlanCallId = await planCallNumber({ count: 2, session });
  if (secondPlanCallId === undefined) {
    return { ...nothingYet({ view: first.view }), blocked: "the successor's plan id was never seen", live: true };
  }
  // The crashed call and its successor: both leases may still be live.
  const onCall = heldBeforeCrash({ ownLiveCalls: 2, session });
  if (onCall !== undefined) {
    return { ...nothingYet({ view: first.view }), blocked: onCall, live: true };
  }
  const crashed = await crashVoiceRenderer({ app: session.app });
  if (crashed.isErr()) {
    return { ...nothingYet({ view: first.view }), blocked: crashed.error.message, live: true };
  }
  await pause({ ms: 20_000 });
  const view = await recoveredVoiceView({ app: session.app, capMs: RELOAD_CAP_MS });
  const firstPlanCallId = first.crashedPlanCallId;
  return {
    ...nothingYet({ view }),
    crash: ({ evidence }) =>
      judgeSecondCrash({
        evidence,
        first: crashedCall({ evidence, planCallId: firstPlanCallId, session }),
        second: crashedCall({ evidence, planCallId: secondPlanCallId, session }),
      }),
    live: true,
  };
};

/**
 * `renderer-killed-connecting`: Talk pressed and the renderer crashed before the call is live; the attempt leaves
 * nothing behind and a fresh press afterwards goes live.
 *
 * @returns what the fresh call showed, with its crash judge
 */
export const rendererKilledConnecting: Scenario = async ({ session }) => {
  const opened = await voicePageOf({ session });
  if (opened.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: opened.error.message };
  }
  const blocked = await pressWhenClear({ session, view: opened.value });
  if (blocked !== undefined) {
    return { ...nothingYet({ view: opened.value }), blocked };
  }
  if (!(await until({ capMs: 10_000, test: async () => isConnecting({ view: opened.value }) }))) {
    return { ...nothingYet({ view: opened.value }), blocked: "the press never showed as connecting" };
  }
  // The attempt connecting holds the one lease its mint wrote.
  const onCall = heldBeforeCrash({ ownLiveCalls: 1, session });
  if (onCall !== undefined) {
    return { ...nothingYet({ view: opened.value }), blocked: onCall };
  }
  const crashed = await crashVoiceRenderer({ app: session.app });
  if (crashed.isErr()) {
    return { ...nothingYet({ view: opened.value }), blocked: crashed.error.message };
  }
  await pause({ ms: 5000 });
  const view = await recoveredVoiceView({ app: session.app, capMs: RELOAD_CAP_MS });
  if (view === undefined) {
    return { ...nothingYet({ view: undefined }), dropped: "the voice page never came back", live: false };
  }
  const logs = readCallLogs({ session });
  if (logs.isErr()) {
    return { ...nothingYet({ view }), blocked: logs.error.message };
  }
  const attemptPlanCallIds = openedPlanCalls({ events: logs.value.planEvents });
  // A lease the attempt left live holds the fresh press back, and past the cap refuses it as `blocked`, naming the
  // lease: so a judged fresh call means the attempt left none.
  const fresh = await goLive({ session, view });
  return {
    ...nothingYet({ view }),
    ...fresh,
    crash: ({ evidence }) => judgeConnectingCrash({ attemptPlanCallIds, evidence, leftLeaseIds: [] }),
  };
};
