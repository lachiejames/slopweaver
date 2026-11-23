/**
 * `call-reopen`: the owner's ruling on a console call proven on three real calls. A says hello and is
 * hung up; B is reopened within the minute on a microphone of nothing but a quiet room, so its window hands the
 * reminder after three seconds and the voice speaks; C is reopened within the minute of B on a microphone that speaks
 * from its first sample, so its window gives way. The witness is pure, `../../../desktop/e2eCallReopen.ts`, read off the
 * call store once cleanup has proven every call ended.
 *
 * **Each call is proven ended before the next press** (`hangUpAndProveEnded`), and each reopen is a fresh launch over
 * the same saved state with its own pre-rendered microphone, never a file rewritten under a running instance.
 *
 * **The reminder is armed for this scenario alone.** A test call is judged a reopen only while the probe file is armed
 * (`../../../talk/e2eReopenProbe.ts`), so every other scenario's opening stays as it was. The drive first waits the
 * minute out so A is never a reopen of the scenario before it, arms the probe for a bounded time, and disarms it
 * whatever happens. A reopen that took longer than the minute to reach its press is minted with no reminder, so B
 * logs no reopen step and the witness FAILS naming that — it can never pass by accident.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { ownProcessStart } from "../../../admit/lockHolder.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { type E2eReopenWitness, reopenWitnessOf } from "../../../desktop/e2eCallReopen.js";
import { type CallRecord, foldCall } from "../../../talk/callRecord.js";
import { readCallEntries } from "../../../talk/callStore.js";
import { armReopenProbe, disarmReopenProbe } from "../../../talk/e2eReopenProbe.js";
import { REOPEN_REMINDER_WINDOW_MS } from "../../../talk/reopenReminder.js";
import { untilTranscriptStill } from "./e2eCallAnswerSettle.js";
import { runSay } from "./e2eCallAudio.js";
import { type E2eMicrophone, generateMicrophone } from "./e2eCallMicrophone.js";
import { liveRows, until } from "./e2eCallPage.js";
import { awaitAnswer, goLive, nothingYet, type Scenario, type ScenarioOutcome, startLive } from "./e2eCallScenarios.js";
import { type CallSession, hangUpAndProveEnded, relaunchCallSession, voicePageOf } from "./e2eCallSession.js";
import { pause } from "./e2ePage.js";

/**
 * How long the probe stays armed if the drive dies before disarming it: the scenario's three calls at their caps, the
 * proofs between them, and room. A judgement value; disarming is the ordinary end.
 */
const PROBE_TTL_MS = 20 * 60_000;

/** How long a reopened call waits for the voice's turn: three seconds' window, the reminder composed, then said. */
const REOPEN_ANSWER_CAP_MS = 60_000;

/** How long a call waits for its last rows to hold still before it is hung up, so its words reach the call file. */
const SETTLE_CAP_MS = 15_000;

/** B's microphone: a quiet room, looped, so the owner says nothing however long the call runs. */
const SILENT: E2eMicrophone = { kind: "room", ms: 30_000 };

/**
 * C's microphone: words tiled from the first sample with gaps past a breath, so whenever the call starts listening it
 * hears the owner within one saying, inside its three seconds.
 */
const SPEAKING: E2eMicrophone = {
  gapMs: 1200,
  kind: "tiled",
  totalMs: 60_000,
  words: "This is an automated end to end test. Wait, one thing first.",
};

/**
 * Render B's and C's microphones into the scenario's own folder, before any call, so neither costs the minute.
 *
 * @returns the two paths, or why one could not be rendered
 */
function renderReopenMicrophones({
  session,
}: {
  session: CallSession;
}): Result<{ readonly silent: string; readonly speaking: string }, E2eCallError> {
  const silent = join(session.spec.scratch, "microphone-silent.wav");
  const speaking = join(session.spec.scratch, "microphone-speaking.wav");
  const quiet = generateMicrophone({ microphone: SILENT, path: silent, run: runSay });
  if (quiet.isErr()) {
    return err(quiet.error);
  }
  const said = generateMicrophone({ microphone: SPEAKING, path: speaking, run: runSay });
  if (said.isErr()) {
    return err(said.error);
  }
  return ok({ silent, speaking });
}

/**
 * Reopen the app on a microphone and press Talk.
 *
 * @param microphone the WAV the reopened app hears
 * @returns the live outcome so far, `live` false with why when it never went live
 */
async function reopenOn({
  session,
  microphone,
}: {
  session: CallSession;
  microphone: string;
}): Promise<{ readonly outcome: ScenarioOutcome; readonly view: ScenarioOutcome["view"] }> {
  const relaunched = await relaunchCallSession({ microphone, session });
  if (relaunched.isErr()) {
    return {
      outcome: { ...nothingYet({ view: undefined }), blocked: relaunched.error.message, live: true },
      view: undefined,
    };
  }
  const opened = await voicePageOf({ session });
  if (opened.isErr()) {
    return {
      outcome: { ...nothingYet({ view: undefined }), blocked: opened.error.message, live: true },
      view: undefined,
    };
  }
  const started = await goLive({ session, view: opened.value });
  return { outcome: { ...nothingYet({ view: opened.value }), ...started }, view: opened.value };
}

/**
 * The three calls, from arming the window to C's answer. The probe is the caller's to disarm.
 *
 * @returns what the calls showed, for the judge
 */
async function driveThree({
  session,
  step,
  silent,
  speaking,
}: {
  session: CallSession;
  step: CallSession["spec"]["step"];
  silent: string;
  speaking: string;
}): Promise<ScenarioOutcome> {
  // A: the call every reopen below picks up from.
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const first = await awaitAnswer({ capMs: step.capMs, ownerText: undefined, view: start.view });
  if (!first.voiceAnswer) {
    return {
      ...nothingYet({ view: start.view }),
      ...first,
      blocked: "the first call never answered, so there was nothing to reopen",
      live: true,
    };
  }
  await untilTranscriptStill({ capMs: SETTLE_CAP_MS, view: start.view });
  const firstOpen = await hangUpAndProveEnded({ session });
  if (firstOpen !== undefined) {
    return { ...nothingYet({ view: undefined }), live: true, stuck: firstOpen };
  }
  // B: reopened, and the owner says nothing.
  const silentReopen = await reopenOn({ microphone: silent, session });
  if (!silentReopen.outcome.live || silentReopen.view === undefined || silentReopen.outcome.blocked !== undefined) {
    return silentReopen.outcome;
  }
  const silentView = silentReopen.view;
  await until({
    capMs: REOPEN_ANSWER_CAP_MS,
    test: async () => (await liveRows({ view: silentView })).some((row) => row.who === "voice"),
  });
  await untilTranscriptStill({ capMs: SETTLE_CAP_MS, view: silentView });
  const silentOpen = await hangUpAndProveEnded({ session });
  if (silentOpen !== undefined) {
    return { ...nothingYet({ view: undefined }), live: true, stuck: silentOpen };
  }
  // C: reopened, and the owner speaks at once.
  const spokenReopen = await reopenOn({ microphone: speaking, session });
  if (!spokenReopen.outcome.live || spokenReopen.view === undefined || spokenReopen.outcome.blocked !== undefined) {
    return spokenReopen.outcome;
  }
  const spoken = await awaitAnswer({ capMs: REOPEN_ANSWER_CAP_MS, ownerText: undefined, view: spokenReopen.view });
  return { ...nothingYet({ view: spokenReopen.view }), ...spoken, live: true };
}

/**
 * `call-reopen`: three calls, A, B silent and C spoken into, the reminder window armed for them alone.
 *
 * @returns what the calls showed, for the judge
 */
export const callReopen: Scenario = async ({ session, step }) => {
  const microphones = renderReopenMicrophones({ session });
  if (microphones.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: microphones.error.message };
  }
  // Every call of the scenario before ended before this one launched, so a minute from here none is in A's window.
  await pause({ ms: REOPEN_REMINDER_WINDOW_MS + 1000 });
  const { home } = session.spec;
  // The writer's start closes the window on a reused pid, so a run `ps` gives no start to never arms it.
  const start = ownProcessStart();
  if (start === undefined) {
    return { ...nothingYet({ view: undefined }), blocked: "could not arm the reopen probe: ps gave this run no start" };
  }
  try {
    armReopenProbe({ home, pid: process.pid, start, untilIso: new Date(Date.now() + PROBE_TTL_MS).toISOString() });
  } catch (cause) {
    return { ...nothingYet({ view: undefined }), blocked: `could not arm the reopen probe: ${String(cause)}` };
  }
  let outcome: ScenarioOutcome;
  try {
    outcome = await driveThree({ session, step, ...microphones.value });
  } catch (cause) {
    disarmReopenProbe({ home });
    throw cause;
  }
  // Left armed, every later scenario of this leg would be reminded, since this run is still the writer.
  const disarmed = disarmReopenProbe({ home });
  if (disarmed.isErr()) {
    return { ...outcome, blocked: `the reopen probe stayed armed after the scenario: ${disarmed.error.message}` };
  }
  return outcome;
};

/**
 * The witness over the scenario's own calls, in the order it placed them, read once cleanup proved them ended.
 *
 * @param session the session, cleaned up
 * @returns the witness, or why a call file could not be read; `undefined` for any other scenario
 */
export function reopenWitnessFor({
  session,
}: {
  session: CallSession;
}): Result<E2eReopenWitness | undefined, E2eCallError> {
  if (session.spec.step.id !== "call-reopen") {
    return ok(undefined);
  }
  return reopenWitnessFromCalls({ callIds: session.tracker.transcriptCallIds, home: session.spec.home });
}

/**
 * The witness over calls read off the call store, each id once, in the order first given.
 *
 * @param callIds the calls the scenario placed, a repeat ignored
 * @returns the witness, or why a call file could not be read
 */
export function reopenWitnessFromCalls({
  callIds,
  home,
}: {
  callIds: readonly string[];
  home: string;
}): Result<E2eReopenWitness, E2eCallError> {
  const calls: CallRecord[] = [];
  for (const callId of new Set(callIds)) {
    const entries = readCallEntries({ callId, home });
    if (entries.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: entries.error.message, path: `call ${callId}` }));
    }
    const call = foldCall({ callId, entries: entries.value, skipped: 0 });
    if (call !== undefined) {
      calls.push(call);
    }
  }
  return ok(reopenWitnessOf({ calls }));
}
