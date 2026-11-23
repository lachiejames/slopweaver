/**
 * What one call scenario reads before its instance launches: the fake microphone it writes, the cursors at the end of
 * the console's and the desktop's logs, and every transcript already in the talk store — so whatever appears after the
 * launch is the session's to prove ended. Nothing here launches anything; a failure leaves nothing running.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { type E2eCallStep, microphoneLeadMs } from "../../../desktop/e2eCallPlan.js";
import { allCallIds } from "../../../talk/callStore.js";
import { generateFakeMicrophone, LEAD_SILENCE_MS, runSay } from "./e2eCallAudio.js";
import { cursorAtEnd, type LogCursor, planLogPath, thisDesktopEventLog } from "./e2eCallEvidenceRead.js";
import {
  type FidelityMicrophone,
  generateTranscriptFidelityMicrophone,
  listSayVoices,
} from "./e2eTranscriptFidelityAudio.js";

/** What a session reads before its launch. */
export interface SessionPreflight {
  readonly fakeAudioPath: string;
  /** The versioned script a `transcription-fidelity` call plays, and its hash; `undefined` on every other scenario. */
  readonly fidelityMicrophone: FidelityMicrophone | undefined;
  readonly planCursor: LogCursor;
  readonly desktopCursor: LogCursor;
  readonly transcriptsBefore: readonly string[];
}

/**
 * Every transcript in the talk store.
 *
 * @param home the state home holding the talk store
 * @returns the call ids, or why the store could not be listed
 */
export function transcriptIdsIn({ home }: { home: string }): Result<readonly string[], E2eCallError> {
  return allCallIds({ home }).mapErr((error) =>
    E2eCallErrors.evidenceUnreadable({ detail: error.message, path: "the talk store" }),
  );
}

/**
 * Write the scenario's microphone: the versioned script for a `transcription-fidelity` call, the step's prompt
 * looped with its silence for every other.
 *
 * @param path where the microphone goes
 * @param scratch the folder a fidelity line's clips are written into
 * @param step the scenario
 * @returns the fidelity microphone's record, `undefined` for any other, or why it could not be written
 */
function microphoneOf({
  path,
  scratch,
  step,
}: {
  path: string;
  scratch: string;
  step: E2eCallStep;
}): Result<FidelityMicrophone | undefined, E2eCallError> {
  if (step.fidelity !== undefined) {
    return generateTranscriptFidelityMicrophone({ listVoices: listSayVoices, path, run: runSay, scratch });
  }
  const leadMs = microphoneLeadMs({ id: step.id, standard: LEAD_SILENCE_MS });
  return generateFakeMicrophone({ leadMs, path, run: runSay, silenceMs: step.silenceMs, words: step.prompt }).map(
    () => undefined,
  );
}

/**
 * Write the microphone and take the cursors and the store's transcripts, before anything is launched.
 *
 * @param scratch the scenario's own folder, which the microphone is written into
 * @param step the scenario step whose prompt the microphone speaks
 * @returns what the launch needs, or why a read failed
 */
export function preflightSession({
  checkout,
  home,
  scratch,
  step,
}: {
  checkout: string;
  home: string;
  scratch: string;
  step: E2eCallStep;
}): Result<SessionPreflight, E2eCallError> {
  const fakeAudioPath = join(scratch, "microphone.wav");
  const mic = microphoneOf({ path: fakeAudioPath, scratch, step });
  if (mic.isErr()) {
    return err(mic.error);
  }
  const planLog = planLogPath({ checkout });
  if (!existsSync(planLog)) {
    return err(
      E2eCallErrors.evidenceUnreadable({
        detail: "no console log — is this checkout's console running?",
        path: planLog,
      }),
    );
  }
  const planCursor = cursorAtEnd({ path: planLog });
  if (planCursor.isErr()) {
    return err(planCursor.error);
  }
  const desktopCursor = cursorAtEnd({ path: thisDesktopEventLog() });
  if (desktopCursor.isErr()) {
    return err(desktopCursor.error);
  }
  const transcriptsBefore = transcriptIdsIn({ home });
  if (transcriptsBefore.isErr()) {
    return err(transcriptsBefore.error);
  }
  return ok({
    desktopCursor: desktopCursor.value,
    fakeAudioPath,
    fidelityMicrophone: mic.value,
    planCursor: planCursor.value,
    transcriptsBefore: transcriptsBefore.value,
  });
}
