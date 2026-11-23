/**
 * What the `transcription-fidelity` scenario's page-side wrapper records each time the console opens a microphone —
 * pure parsing of the value `page.evaluate` hands back, so a page that recorded nothing, or something else, is told
 * apart from one that recorded a capture.
 *
 * The wrapper is the test's, never the product's: it merges the arm's processing into the console's own
 * `getUserMedia` request (`site/components/voice/audioRouteBrowser.ts` `openPickedMic`) and reads back what Chromium
 * applied. Production constraints are untouched, so the comparison measures the installed app as the owner runs it.
 */
import { isRecord } from "#lib/parsers.js";
import type { E2eAppliedMicSettings } from "./e2eTranscriptFidelityReport.js";

/** One microphone the page opened: when, on the page's own monotonic `performance.now()` clock, and what Chromium applied. */
export interface E2eMicCapture {
  readonly openedAtMs: number;
  readonly applied: E2eAppliedMicSettings;
}

/** The window property the wrapper records into. */
export const MIC_CAPTURE_GLOBAL = "__slopweaverFidelityMicCaptures";

/** One applied flag: a boolean, or `null` for one Chromium omitted. Anything else is not a capture. */
function flagOf({ value }: { value: unknown }): boolean | null | undefined {
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  return undefined;
}

/**
 * The captures the page recorded, or `undefined` when what it handed back is not a list of them.
 *
 * @param value what `page.evaluate` returned for {@link MIC_CAPTURE_GLOBAL}
 * @returns the captures, in the order the microphones opened
 */
export function parseMicCaptures({ value }: { value: unknown }): readonly E2eMicCapture[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const captures: E2eMicCapture[] = [];
  for (const one of value as readonly unknown[]) {
    if (!isRecord(one)) {
      return undefined;
    }
    const row = one;
    const echoCancellation = flagOf({ value: row["echoCancellation"] });
    const noiseSuppression = flagOf({ value: row["noiseSuppression"] });
    const autoGainControl = flagOf({ value: row["autoGainControl"] });
    const openedAtMs = row["openedAtMs"];
    if (
      echoCancellation === undefined ||
      noiseSuppression === undefined ||
      autoGainControl === undefined ||
      typeof openedAtMs !== "number"
    ) {
      return undefined;
    }
    captures.push({ applied: { autoGainControl, echoCancellation, noiseSuppression }, openedAtMs });
  }
  return captures;
}
