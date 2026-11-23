/**
 * One deliverable the owner explicitly steered that is at risk, as the console reads it from `talk steer-risk --json`
 * (`src/talk/steerRisk.ts`) and the voice says it once (`WindowNoticeLines.announceSteerRisk`).
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is
 * known. The server reads the notes itself; the page only paces the asks, so the voice never names a risk a page
 * asserted. Every field is bounded here, at the one place the verb's output enters the console.
 */
import { isBag } from "./bag";

/** One steer note as the voice says it. */
export interface SteerRiskNotice {
  /** The note's hand-step id, which the line is claimed under. */
  readonly stepId: string;
  /** The note's sentence, naming the row. */
  readonly what: string;
  /** Why it is at risk. */
  readonly why: string;
}

/** The longest step id taken: a monitor step id is a prefix, a stem and a six-hex digest. */
const STEP_ID_MAX = 200;

/** The longest sentence taken, a note's `what` (120) or its reason (200), with room. */
const TEXT_MAX = 400;

/** The most notes taken in one answer. */
const NOTICES_MAX = 20;

/**
 * One bounded string, or `undefined`.
 *
 * @param value what the verb printed in the field
 * @param max the longest taken
 * @returns the trimmed text, or `undefined` when it is not a non-empty string within the bound
 */
function boundedText({ value, max }: { value: unknown; max: number }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : undefined;
}

/**
 * Read one notice the verb printed.
 *
 * @param value one element of the verb's `notices`
 * @returns the notice, or `undefined` when any field is missing or out of bounds
 */
export function steerRiskNoticeOf({ value }: { value: unknown }): SteerRiskNotice | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const stepId = boundedText({ max: STEP_ID_MAX, value: value["stepId"] });
  const what = boundedText({ max: TEXT_MAX, value: value["what"] });
  const why = boundedText({ max: TEXT_MAX, value: value["why"] });
  if (stepId === undefined || what === undefined || why === undefined) {
    return undefined;
  }
  return { stepId, what, why };
}

/** The verb's whole answer: every notice it read, and how many register lines it could not. */
export interface SteerRiskAnswer {
  readonly notices: readonly SteerRiskNotice[];
  /** Register lines that would not read — any one may be a steer note, so a non-zero count is never "none open". */
  readonly unreadLines: number;
}

/**
 * Read the verb's whole answer. One unreadable notice refuses the whole answer: a list that silently lost one would
 * leave a risk unsaid while reading as complete. The unread-line count is required for the same reason.
 *
 * @param value the parsed JSON `talk steer-risk --json` printed
 * @returns the notices and the unread count, or `undefined` when the answer is not one this console can read
 */
export function steerRiskAnswerOf({ value }: { value: unknown }): SteerRiskAnswer | undefined {
  if (!isBag(value) || !Array.isArray(value["notices"]) || value["notices"].length > NOTICES_MAX) {
    return undefined;
  }
  const unreadLines = value["unreadLines"];
  if (typeof unreadLines !== "number" || !Number.isSafeInteger(unreadLines) || unreadLines < 0) {
    return undefined;
  }
  const notices: SteerRiskNotice[] = [];
  for (const one of value["notices"]) {
    const notice = steerRiskNoticeOf({ value: one });
    if (notice === undefined) {
      return undefined;
    }
    notices.push(notice);
  }
  return { notices, unreadLines };
}
