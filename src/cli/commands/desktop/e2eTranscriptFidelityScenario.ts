/**
 * `transcription-fidelity`'s drive: one call of the paired microphone comparison
 * (`../../../desktop/e2eTranscriptFidelityCorpus.ts`). The fake microphone plays the versioned script; this drive sets
 * the arm's processing on the console's own microphone request, holds the call until the script has been spoken and
 * the last line has had time to arrive, and records what Chromium applied. Scoring is never done here: the trial is
 * built from the call FILE once the session has proven the call ended (`./e2eTranscriptFidelityTrial.ts`).
 *
 * **The arm is set from the test, not the product.** Before Talk is pressed, `navigator.mediaDevices.getUserMedia` is
 * wrapped on the voice page so the console's request (`site/components/voice/audioRouteBrowser.ts` `openPickedMic`)
 * has the arm's three processing flags merged in, and each opened track's `getSettings()` is recorded. Control sets
 * all three to true explicitly, so both arms of a pair pass through the same wrapper, and what is measured is the
 * console the owner runs. An alternative routes the arm through a launch switch and the preload instead; that
 * needs a desktop and site change landed on the owner's main checkout before the first call, for no difference in what
 * Chromium is asked.
 *
 * **The hold is a clock, never the transcript.** The server decides where the owner's turns begin and end, so waiting on a
 * row count would make the measurement wait on the thing measured. The microphone file starts when the page opens
 * it, so the call is held until that instant plus the script's own length plus {@link SETTLE_MS}, within the cap.
 */
import type { Page } from "playwright-core";

import { turnAndAnswer } from "../../../desktop/e2eCallRows.js";
import { MIC_CAPTURE_GLOBAL, parseMicCaptures } from "../../../desktop/e2eTranscriptFidelityCapture.js";
import { type E2eMicProcessing, micProcessingOf } from "../../../desktop/e2eTranscriptFidelityReport.js";
import { hangUp, isLive, liveRows, until } from "./e2eCallPage.js";
import { goLive, nothingYet, type Scenario } from "./e2eCallScenarios.js";
import { voicePageOf } from "./e2eCallSession.js";
import { pause } from "./e2ePage.js";

/** Past the script's last word: the quiet glossary line's final transcript, and the voice's "okay" after it. */
const SETTLE_MS = 30_000;

/** How long after the call is live the page has to have opened its microphone. */
const OPENED_CAP_MS = 15_000;

/** How often the held call is checked still live. */
const LIVE_EVERY_MS = 5000;

/** How long a pressed hang-up has to take the call off live before the captures are read. */
const ENDED_CAP_MS = 15_000;

/**
 * Wrap the page's `getUserMedia` so every audio request carries the arm's processing, and record what each opened
 * track reports applying.
 *
 * @param page the voice window
 * @param processing the arm's flags
 * @returns nothing once installed
 */
async function installMicOverride({ page, processing }: { page: Page; processing: E2eMicProcessing }): Promise<void> {
  await page.evaluate(
    ({ key, override }) => {
      const devices = navigator.mediaDevices;
      const original = devices.getUserMedia.bind(devices);
      const box: unknown[] = [];
      Object.defineProperty(window, key, { configurable: true, value: box });
      devices.getUserMedia = async (constraints) => {
        const audio: unknown =
          constraints !== undefined && Object.hasOwn(constraints, "audio") ? constraints.audio : undefined;
        // Only a request that asks for audio is rebuilt; any other reaches Chromium as the page's own object.
        let request = constraints;
        if (typeof audio === "object" && audio !== null) {
          request = { ...constraints, audio: { ...audio, ...override } };
        } else if (audio === true) {
          request = { ...constraints, audio: { ...override } };
        }
        const stream = await original(request);
        const flag = ({ value }: { value: unknown }): boolean | null => (typeof value === "boolean" ? value : null);
        for (const track of stream.getAudioTracks()) {
          const settings = track.getSettings();
          box.push({
            autoGainControl: flag({ value: settings.autoGainControl }),
            echoCancellation: flag({ value: settings.echoCancellation }),
            noiseSuppression: flag({ value: settings.noiseSuppression }),
            openedAtMs: performance.now(),
          });
        }
        return stream;
      };
    },
    { key: MIC_CAPTURE_GLOBAL, override: processing },
  );
}

/**
 * What the wrapper has recorded so far.
 *
 * @param page the voice window
 * @returns the captures, or `undefined` when the page holds none it can hand back
 */
async function readMicCaptures({ page }: { page: Page }): Promise<ReturnType<typeof parseMicCaptures>> {
  const value: unknown = await page
    .evaluate((key) => {
      const held: unknown = Reflect.get(window, key);
      return held;
    }, MIC_CAPTURE_GLOBAL)
    .catch(() => undefined);
  return parseMicCaptures({ value });
}

/**
 * The page's own monotonic clock, the one the wrapper stamps each opened microphone with.
 *
 * @param page the voice window
 * @returns its `performance.now()`, `undefined` when the page cannot be read
 */
async function pageNowMs({ page }: { page: Page }): Promise<number | undefined> {
  const value: unknown = await page.evaluate(() => performance.now()).catch(() => undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `transcription-fidelity`: one call hears the whole script under the arm's processing, and the processing Chromium
 * applied is kept on the session for the trial.
 *
 * @returns what the call showed, for the judge
 */
export const transcriptionFidelity: Scenario = async ({ session, step }) => {
  const spec = step.fidelity;
  const microphone = session.fidelityMicrophone;
  if (spec === undefined || microphone === undefined) {
    return {
      ...nothingYet({ view: undefined }),
      blocked: "transcription-fidelity ran without its schedule or microphone",
    };
  }
  const opened = await voicePageOf({ session });
  if (opened.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: opened.error.message };
  }
  const view = opened.value;
  const { page } = view;
  if (page === undefined) {
    return { ...nothingYet({ view }), blocked: "the voice window has no page to set the microphone's processing on" };
  }
  const installed = await installMicOverride({ page, processing: micProcessingOf({ variant: spec.variant }) }).then(
    () => undefined,
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );
  if (installed !== undefined) {
    return { ...nothingYet({ view }), blocked: `could not set the microphone's processing: ${installed}` };
  }
  const pressedAtMs = performance.now();
  const started = await goLive({ session, view });
  if (!started.live) {
    return { ...nothingYet({ view }), ...started };
  }
  const openedAtMs = await firstOpenedAt({ page });
  if (openedAtMs === undefined) {
    return {
      ...nothingYet({ view }),
      blocked: "the call went live with no microphone opened through the page",
      live: true,
    };
  }
  const neededMs = microphone.scriptEndMs + SETTLE_MS;
  const held = await holdThroughScript({ capMs: step.capMs, neededMs, openedAtMs, page, pressedAtMs, view });
  session.fidelityHolds.push({ heldMs: held.heldMs, neededMs });
  return hangUpAndCollect({ dropped: held.dropped, page, session, view });
};

/** The voice window a call is driven through. */
type CallView = Parameters<typeof isLive>[0]["view"];

/**
 * When the page first opened its microphone, on the page's own clock.
 *
 * @param page the voice window
 * @returns the instant, or `undefined` when no microphone opened within the cap
 */
async function firstOpenedAt({ page }: { page: Page }): Promise<number | undefined> {
  let openedAtMs: number | undefined;
  await until({
    capMs: OPENED_CAP_MS,
    test: async () => {
      const captures = await readMicCaptures({ page });
      openedAtMs = captures === undefined ? undefined : captures[0]?.openedAtMs;
      return openedAtMs !== undefined;
    },
  });
  return openedAtMs;
}

/**
 * Hold the call until the script has been spoken and settled, it drops, the page clock goes unreadable, or the cap.
 * Both clocks are monotonic: the hold and its proof on the page's, the cap on this process's. A wall-clock jump can
 * neither end the hold early nor make a short one read as whole.
 *
 * @param capMs the step's cap, on this process's clock from the press
 * @param neededMs how long the microphone must have been open for the hold to be whole
 * @param openedAtMs when the microphone opened, on the page's clock
 * @param pressedAtMs when Talk was pressed, on this process's clock
 * @returns how long the page clock last proved held, `null` when it could not be read, and why the call dropped
 */
async function holdThroughScript({
  capMs,
  neededMs,
  openedAtMs,
  page,
  pressedAtMs,
  view,
}: {
  capMs: number;
  neededMs: number;
  openedAtMs: number;
  page: Page;
  pressedAtMs: number;
  view: CallView;
}): Promise<{ readonly heldMs: number | null; readonly dropped: string | undefined }> {
  const heldNow = async (): Promise<number | null> => {
    const now = await pageNowMs({ page });
    return now === undefined ? null : now - openedAtMs;
  };
  let heldMs = await heldNow();
  let dropped: string | undefined;
  while (dropped === undefined && heldMs !== null && heldMs < neededMs && performance.now() - pressedAtMs < capMs) {
    await pause({ ms: Math.min(LIVE_EVERY_MS, Math.max(0, neededMs - heldMs)) });
    if (!(await isLive({ view }))) {
      dropped = `the call dropped ${String(Math.round(heldMs / 1000))}s after the microphone opened`;
    }
    heldMs = await heldNow();
  }
  return { dropped, heldMs };
}

/**
 * Read the answer, hang up, and only once the call is off live read the captures onto the session.
 *
 * @param dropped why the call already dropped during the hold, if it did
 * @returns what the call showed, for the judge
 */
async function hangUpAndCollect({
  dropped,
  page,
  session,
  view,
}: {
  dropped: string | undefined;
  page: Page;
  session: Parameters<Scenario>[0]["session"];
  view: CallView;
}): ReturnType<Scenario> {
  const answer = turnAndAnswer({ ownerText: undefined, rows: await liveRows({ view }) });
  // The captures are read only once the call is off live: a microphone the page opened after an earlier read would
  // replay the looping file into the call unseen, and one opened after the call ended cannot reach it.
  // A hang-up that finds no call to end means the call dropped after the last live check.
  let lost = dropped;
  if (!(await hangUp({ view })) && lost === undefined) {
    lost = "the call dropped before the test could hang it up";
  }
  await until({ capMs: ENDED_CAP_MS, test: async () => !(await isLive({ view })) });
  if (await isLive({ view })) {
    return {
      ...nothingYet({ view }),
      ...answer,
      blocked: "the call would not hang up, so a microphone opened after its captures were read could go unseen",
      dropped: lost,
      live: true,
    };
  }
  const captures = await readMicCaptures({ page });
  if (captures !== undefined) {
    session.micCaptures.push(...captures);
  }
  return { ...nothingYet({ view }), ...answer, dropped: lost, live: true };
}
