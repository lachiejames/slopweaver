/**
 * The decision `datadog shot monitor` takes over one relay capture — pure, so every arm of it is a test.
 *
 * `browser/datadogMonitorBacktest.ts` runs the page and reports what it saw; this module says whether that is
 * evidence. The order is `shot file`'s order, for that verb's reason: the WINDOW is proved before anything
 * else is believed, because a panel computed over the wrong span reads back perfectly well, and the order a
 * reader sees a refusal in is the order they believe the cause.
 *
 * Everything the page could have got wrong is checked again here rather than taken from its `ready`: the
 * picker's own value, a sign-in wall on the console's own host (the off-host one is refused by the transport),
 * the panel's text, which `parseBacktestPanel` turns into numbers, and the panel's position either side of
 * the shutter, which is what the crop is cut from.
 */
import type { BacktestPanelFrame, MonitorBacktestObservation } from "../../browser/datadogMonitorBacktest.js";
import { err, ok, type Result } from "../../lib/result.js";
import { cropPng } from "../../visualEvidence/annotate.js";
import { decideEvidenceCrop } from "../../visualEvidence/crop.js";
import { visualEvidenceErrorLines } from "../../visualEvidence/evidenceErrors.js";
import { identifyImageBytes } from "../../visualEvidence/imageIo.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";
import { PAST_ONE_WEEK } from "./panelScript.js";
import { isDatadogSignInWall, judgeWindowProof, previewSpanSeconds, type WindowProof } from "./proof.js";
import { type BacktestReading, parseBacktestPanel } from "./reading.js";

/** What a capture that passed every check carries forward to the write. */
export interface JudgedMonitorCapture {
  readonly proof: WindowProof;
  readonly reading: BacktestReading;
  /** The whole VIEWPORT picture; {@link cropMonitorPanel} cuts it to `frame`. */
  readonly png: Uint8Array;
  readonly frame: BacktestPanelFrame;
}

/** The sentence a wait that ended short of `ready` is refused with. */
function waitedFor({ observation }: { observation: MonitorBacktestObservation }): string {
  switch (observation.readiness) {
    case "no-picker":
      return "the time-range picker never appeared on the edit page";
    case "window-unset":
      return `the picker could not be put on ${PAST_ONE_WEEK}${observation.windowError === null ? "" : `: ${observation.windowError}`}`;
    case "timeout":
      return `${String(observation.polls)} passes over ${String(Math.round(observation.elapsedMs / 1000))}s without two identical, fully marked readings`;
    case "ready":
      return `the panel settled and the screenshot was not written${observation.screenshotError === null ? "" : `: ${observation.screenshotError}`}`;
    case "unsupported":
      return "Datadog reported the query as not supported";
    default: {
      const unreachable: never = observation.readiness;
      return unreachable;
    }
  }
}

/**
 * Judge one capture: the page it settled on, the window, the picture, the panel's numbers.
 *
 * @param observation what the relay capture saw
 * @param monitorId the monitor asked for, for the refusal that names it
 * @param consoleHost the console host this install is configured for, for the sign-in wall check
 * @returns the proof grade, the reading and the bytes to grade on disk, or the one refusal that applies
 */
export function judgeMonitorCapture({
  observation,
  monitorId,
  consoleHost,
}: {
  observation: MonitorBacktestObservation;
  monitorId: string;
  consoleHost: string;
}): Result<JudgedMonitorCapture, DatadogShotError> {
  if (isDatadogSignInWall({ consoleHost, url: observation.finalUrl })) {
    return err(
      DatadogShotErrors.captureFailed({
        detail: "the console showed its sign-in page, so the Chrome the relay reached is not signed in to Datadog",
        url: observation.finalUrl,
      }),
    );
  }
  if (observation.readiness === "unsupported") {
    return err(DatadogShotErrors.backtestUnsupported({ monitorId }));
  }
  const spans = observation.previewUrls
    .map((url) => previewSpanSeconds({ url }))
    .filter((span: number | null) => span !== null);
  const proof = judgeWindowProof({ spans });
  if (proof.isErr()) {
    return err(proof.error);
  }
  const settled = settledPanelOf({ observation });
  if (settled.isErr()) {
    return err(settled.error);
  }
  const parsed = parseBacktestPanel({ panelText: settled.value.panelText });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const frame = steadyFrameOf({ observation });
  if (frame.isErr()) {
    return err(frame.error);
  }
  return ok({ frame: frame.value, png: settled.value.png, proof: proof.value, reading: parsed.value });
}

/**
 * The picture and the panel's text, once the page's own `ready` is checked again: a reading, a PNG, the
 * picker on the claimed window, the region marked with its Alert count boxed, and text to read.
 */
function settledPanelOf({
  observation,
}: {
  observation: MonitorBacktestObservation;
}): Result<{ readonly png: Uint8Array; readonly panelText: string }, DatadogShotError> {
  const reading = observation.reading;
  if (reading === null) {
    return err(DatadogShotErrors.panelNeverSettled({ unmet: [], waitedFor: waitedFor({ observation }) }));
  }
  if (observation.readiness !== "ready" || observation.png === null) {
    return err(DatadogShotErrors.panelNeverSettled({ unmet: reading.unmet, waitedFor: waitedFor({ observation }) }));
  }
  if (reading.pickerValue !== PAST_ONE_WEEK) {
    return err(
      DatadogShotErrors.panelNeverSettled({
        unmet: [`the picker reading "${PAST_ONE_WEEK}" (it read ${JSON.stringify(reading.pickerValue)})`],
        waitedFor: "the panel was photographed over a window other than the one this proof claims",
      }),
    );
  }
  if (!reading.marked || !reading.alertBoxed) {
    return err(
      DatadogShotErrors.panelNeverSettled({ unmet: reading.unmet, waitedFor: "the region was not fully marked" }),
    );
  }
  if (reading.panelText === null) {
    return err(
      DatadogShotErrors.panelNeverSettled({ unmet: ["the panel's text"], waitedFor: "the marked panel had no text" }),
    );
  }
  return ok({ panelText: reading.panelText, png: observation.png });
}

/** The region's geometry, refused when either reading around the shutter is missing or they disagree. */
function steadyFrameOf({
  observation,
}: {
  observation: MonitorBacktestObservation;
}): Result<BacktestPanelFrame, DatadogShotError> {
  const { frame, frameAfter } = observation;
  if (frame === null || frameAfter === null) {
    return err(
      DatadogShotErrors.panelCropRefused({
        problems: ["the marked panel's position was not read on both sides of the shutter"],
      }),
    );
  }
  if (JSON.stringify(frame) !== JSON.stringify(frameAfter)) {
    return err(
      DatadogShotErrors.panelCropRefused({
        problems: [
          `the marked panel moved during the shot (${JSON.stringify(frame)} then ${JSON.stringify(frameAfter)})`,
        ],
      }),
    );
  }
  return ok(frame);
}

/**
 * Cut the viewport picture down to the marked panel, from the page's own rectangle at the page's own paint
 * scale — `visualEvidence/crop.ts`'s decision, so the zoom the owner's Chrome runs at cannot offset it, and a
 * panel that does not lie wholly inside the viewport is refused rather than cut short.
 *
 * @param png the viewport PNG the snippet wrote
 * @param frame the marked region's steady geometry
 * @returns the cropped PNG bytes, or why no crop could be taken
 */
export async function cropMonitorPanel({
  png,
  frame,
}: {
  png: Uint8Array;
  frame: BacktestPanelFrame;
}): Promise<Result<Uint8Array, DatadogShotError>> {
  const identity = await identifyImageBytes({ bytes: png });
  if (identity.isErr()) {
    return err(DatadogShotErrors.panelCropRefused({ problems: visualEvidenceErrorLines({ error: identity.error }) }));
  }
  const crop = decideEvidenceCrop({
    geometry: {
      devicePixelRatio: frame.devicePixelRatio,
      frameHeight: frame.viewportHeight,
      frameWidth: frame.viewportWidth,
      imageHeight: identity.value.heightPx,
      imageWidth: identity.value.widthPx,
    },
    regions: [{ name: "backtest panel", rect: frame.rect }],
  });
  if (crop.isErr()) {
    return err(DatadogShotErrors.panelCropRefused({ problems: visualEvidenceErrorLines({ error: crop.error }) }));
  }
  const cropped = await cropPng({ bytes: png, rect: crop.value.rect });
  if (cropped.isErr()) {
    return err(DatadogShotErrors.panelCropRefused({ problems: visualEvidenceErrorLines({ error: cropped.error }) }));
  }
  return ok(cropped.value.bytes);
}
