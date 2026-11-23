/**
 * The one notice the page posts when what the owner is doing has drifted from what they said they would do
 * (`../app/api/talk/call/[id]/drift/route.ts`), bounded here so the route, the watch and the spoken line share one
 * shape.
 *
 * It carries the owner's plan's label, the frontmost application's name and how long, and nothing else: no window title and no
 * bundle id ever leaves the page ([why](../../docs/console/voice-notices-drift.md)).
 */
import { isBag } from "./bag";

/** The longest plan label a notice carries: it completes "you said you'd …", one short spoken phrase. */
export const DRIFT_PLAN_MAX_CHARS = 80;

/** The longest application name a notice carries. */
export const DRIFT_APP_MAX_CHARS = 60;

/** The longest notice id taken: a UUID, with room. */
export const DRIFT_NOTICE_ID_MAX_CHARS = 80;

/** The most minutes a notice may name: a day, so the route stays bounded without a plan expiry. */
export const DRIFT_MAX_MINUTES = 24 * 60;

/** One drift, as the page posts it and the server says it. */
export interface DriftNotice {
  /** Minted once per drift and kept through every retry, so the line is said once. */
  readonly noticeId: string;
  /** The application the owner has been in, as the desktop shell named it. */
  readonly app: string;
  /** The owner's plan's label: what completes "you said you'd …". */
  readonly plan: string;
  /** Whole minutes the owner has been in that application, at least the dwell. */
  readonly minutes: number;
}

/**
 * A text field as a notice carries it: control characters gone, whitespace collapsed, capped.
 *
 * @param value the field as it arrived
 * @param maxChars the cap, in characters
 * @returns the bounded text, or `undefined` for a non-string or one that is empty once cleaned
 */
export function boundedDriftField({ value, maxChars }: { value: unknown; maxChars: number }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const line = value
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (line === "") {
    return undefined;
  }
  return line.slice(0, maxChars).trimEnd();
}

/**
 * A notice read from a post, strictly: every field present and bounded, minutes a whole number in range.
 *
 * @param value the post's parsed body
 * @returns the notice, or `undefined` for anything else
 */
export function driftNoticeOf({ value }: { value: unknown }): DriftNotice | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const noticeId = boundedDriftField({ maxChars: DRIFT_NOTICE_ID_MAX_CHARS, value: value["noticeId"] });
  const app = boundedDriftField({ maxChars: DRIFT_APP_MAX_CHARS, value: value["app"] });
  const plan = boundedDriftField({ maxChars: DRIFT_PLAN_MAX_CHARS, value: value["plan"] });
  const minutes = value["minutes"];
  const minutesOk =
    typeof minutes === "number" && Number.isSafeInteger(minutes) && minutes > 0 && minutes <= DRIFT_MAX_MINUTES;
  if (noticeId === undefined || app === undefined || plan === undefined || !minutesOk) {
    return undefined;
  }
  return { app, minutes, noticeId, plan };
}
