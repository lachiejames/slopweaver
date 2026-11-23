/**
 * What a call needs before it can connect: the microphone, and the OpenAI live client. The client is loaded on the
 * press rather than with the shell: every console page carries the voice provider and almost no page load is a
 * call, so a static import put the whole client in every page's first script (`slopweaver perf console`).
 */
import type { OpenAILiveWebRTC } from "openai/live/webrtc";

import type { LinkSchedule } from "../../lib/callLink";
import type { CallOpenMode } from "../../lib/callRollover";
import type { OpenedMic } from "./audioRouteBrowser";

/**
 * Both halves a call connects with; the sentence the call ends on when either one could not be had; or that a newer
 * press took over while they were being had, with nothing left held.
 */
export type PreparedCall =
  | { readonly opened: OpenedMic; readonly LiveWebRTC: typeof OpenAILiveWebRTC }
  | { readonly why: string }
  | { readonly superseded: true };

/** Stop every track of a stream, so nothing is left holding the microphone or a screen capture. */
export function stopTracks({ stream }: { stream: MediaStream }): void {
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

/**
 * How long a reconnect or a rollover's successor may take to prepare before it counts as a failed attempt. A
 * reconnect once journalled its first attempt as scheduled and nothing after, and preparing is the one step of an
 * attempt nothing else bounded. A minute, not thirty seconds: a loaded machine opening the microphone slowly is not a
 * failure, and a bound it always meets would only churn attempts. Repro: `grep -n '"reconnect"'
 * $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 */
export const CARRYING_PREPARE_TIMEOUT_MS = 60_000;

/**
 * How long a call opened in `mode` may take to prepare: unbounded on the owner's press, which may sit on a permission prompt
 * for as long as they take; {@link CARRYING_PREPARE_TIMEOUT_MS} when the page opens it on its own.
 *
 * @returns the bound in milliseconds, or `undefined` for none
 */
export function callPreparationTimeoutMs({ mode }: { mode: CallOpenMode }): number | undefined {
  if (mode === "fresh") {
    return undefined;
  }
  return CARRYING_PREPARE_TIMEOUT_MS;
}

/**
 * Prepare a call ({@link prepareCallSteps}), failing it once its bound ({@link callPreparationTimeoutMs}) passes. The
 * attempt that ran out stops being wanted at that instant, so a microphone it is handed late is released the moment it
 * arrives, exactly as a superseded one is, and its late answer is never read.
 *
 * @param openMic the audio route's own microphone opener
 * @param stillWanted whether this call is still the current one
 * @param mode how the call was opened, which sets its bound
 * @param schedule runs `run` after `ms`, returning what cancels it
 * @returns both halves, why the call cannot connect, or that it was superseded
 */
export async function prepareCall({
  openMic,
  stillWanted,
  mode,
  schedule,
}: {
  openMic: () => Promise<OpenedMic>;
  stillWanted: () => boolean;
  mode: CallOpenMode;
  schedule: LinkSchedule;
}): Promise<PreparedCall> {
  const timeoutMs = callPreparationTimeoutMs({ mode });
  if (timeoutMs === undefined) {
    return prepareCallSteps({ onStep: () => undefined, openMic, stillWanted });
  }
  let timedOut = false;
  let waitingOn = "the microphone";
  let held: OpenedMic | undefined;
  let cancel: () => void = () => undefined;
  const expired = new Promise<PreparedCall>((resolve) => {
    cancel = schedule({
      ms: timeoutMs,
      run: () => {
        timedOut = true;
        // A client load that never settles would otherwise keep the microphone it was handed.
        if (held !== undefined) {
          stopTracks({ stream: held.stream });
        }
        resolve({
          why: `the call did not finish preparing within ${String(timeoutMs / 1_000)} seconds, waiting on ${waitingOn}`,
        });
      },
    });
  });
  const steps = prepareCallSteps({
    onStep: ({ step, holding }) => {
      waitingOn = step;
      held = holding;
    },
    openMic,
    stillWanted: () => !timedOut && stillWanted(),
  });
  const ready = await Promise.race([steps, expired]);
  cancel();
  return ready;
}

/**
 * Open the microphone, then load the live client. The call is asked whether it is still wanted after each await, so a
 * superseded one releases the microphone the moment it has it, rather than holding it while the client loads; a client that does not load releases it too, so a failed call never leaves it held. The caller
 * still judges the answer once more with {@link onReceipt}: returning from here is another turn of the queue, and a
 * newer press can take it.
 *
 * @param openMic the audio route's own microphone opener
 * @param stillWanted whether this call is still the current one
 * @param onStep told what the call waits on next once the microphone is held, and the microphone it holds
 * @returns both halves, why the call cannot connect, or that it was superseded
 */
export async function prepareCallSteps({
  openMic,
  stillWanted,
  onStep,
}: {
  openMic: () => Promise<OpenedMic>;
  stillWanted: () => boolean;
  onStep: (input: { step: string; holding: OpenedMic }) => void;
}): Promise<PreparedCall> {
  let opened: OpenedMic;
  try {
    opened = await openMic();
  } catch (cause) {
    if (!stillWanted()) {
      return { superseded: true };
    }
    return { why: `the microphone was not available: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!stillWanted()) {
    stopTracks({ stream: opened.stream });
    return { superseded: true };
  }
  onStep({ holding: opened, step: "the call client" });
  let LiveWebRTC: typeof OpenAILiveWebRTC;
  try {
    ({ OpenAILiveWebRTC: LiveWebRTC } = await import("openai/live/webrtc"));
  } catch (cause) {
    stopTracks({ stream: opened.stream });
    if (!stillWanted()) {
      return { superseded: true };
    }
    return { why: `the call client did not load: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!stillWanted()) {
    stopTracks({ stream: opened.stream });
    return { superseded: true };
  }
  return { LiveWebRTC, opened };
}

/**
 * Judge a prepared call once more where it is received, synchronously after the await: a call superseded in the turn
 * {@link prepareCall}'s return took is superseded here too, its microphone released and its failure sentence dropped,
 * so a stale answer can neither hold the microphone nor end the newer call.
 *
 * @param ready what {@link prepareCall} answered
 * @param stillWanted whether this call is still the current one
 * @returns the answer unchanged while the call is current, else superseded with nothing held
 */
export function onReceipt({ ready, stillWanted }: { ready: PreparedCall; stillWanted: () => boolean }): PreparedCall {
  if ("superseded" in ready || stillWanted()) {
    return ready;
  }
  if ("opened" in ready) {
    stopTracks({ stream: ready.opened.stream });
  }
  return { superseded: true };
}
