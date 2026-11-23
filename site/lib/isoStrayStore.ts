/**
 * The ISO watch's state as this browser keeps it between page loads, so the cadence outlives the hook that folds it
 * (`../components/voice/useFrontWindowNotices.ts`). Without it a reload mid-stretch woke an idle watch, and a fresh id
 * the server's ledger had never seen bought another first nudge ten minutes after the last one, then a third.
 *
 * Every field is written, `null` standing for absent, and read back strictly: anything else is no state at all, which
 * is an idle watch. A stale one is harmless, since the fold ends a stretch on the gap since its newest off-ISO sample.
 * A pending nudge is kept with its id, so a retry after a reload is the same nudge and the ledger says it once; an id
 * not of the shape the page mints is no state, so nothing a store holds rides out as an id.
 */
import { isBag, nullableNum } from "./bag";
import { DRIFT_MAX_MINUTES } from "./driftNotice";
import { isoNudgeNoticeOf } from "./isoNudgeNotice";
import { ISO_STRAY_AGAIN_MS, ISO_STRAY_DWELL_MS, type IsoStrayState } from "./isoStrayWatch";

/** The `localStorage` key the watch lives under, one per browser like the theme. */
export const ISO_STRAY_STORAGE_KEY = "sw-voice-iso-stray";

/** The shape `crypto.randomUUID()` mints, the only notice id the page ever writes. */
const PAGE_MINTED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The state as stored text.
 *
 * @param state the watch
 * @returns its JSON, every field present
 */
export function isoStrayStateText({ state }: { state: IsoStrayState }): string {
  const { lastOffMs, lastToldMs, pending, stretchStartMs, toldInStretch } = state;
  return JSON.stringify({
    lastOffMs: storedOf({ value: lastOffMs }),
    lastToldMs: storedOf({ value: lastToldMs }),
    pending: storedOf({ value: pending }),
    stretchStartMs: storedOf({ value: stretchStartMs }),
    toldInStretch,
  });
}

/**
 * One field as stored, absence written as the `null` JSON keeps rather than the `undefined` it drops.
 *
 * @param value the field, absent or not
 * @returns the field, or `null` for absent
 */
function storedOf<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * The state read back from stored text, strictly.
 *
 * @param text what the key held, `null` when it held nothing
 * @param nowMs the instant it is read at, past which no kept time may lie
 * @returns the state, or `undefined` for anything this module did not write
 */
export function isoStrayStateOf({ text, nowMs }: { text: string | null; nowMs: number }): IsoStrayState | undefined {
  if (text === null) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isBag(value) || Object.keys(value).length !== 5) {
    return undefined;
  }
  const lastOffMs = nullableNum({ bag: value, key: "lastOffMs" });
  const lastToldMs = nullableNum({ bag: value, key: "lastToldMs" });
  const stretchStartMs = nullableNum({ bag: value, key: "stretchStartMs" });
  const { toldInStretch } = value;
  if (lastOffMs === false || lastToldMs === false || stretchStartMs === false) {
    return undefined;
  }
  if (toldInStretch !== 0 && toldInStretch !== 1 && toldInStretch !== 2) {
    return undefined;
  }
  if (value["pending"] === null) {
    return consistentOrNone({
      nowMs,
      state: { lastOffMs, lastToldMs, pending: undefined, stretchStartMs, toldInStretch },
    });
  }
  const pending = isoNudgeNoticeOf({ value: value["pending"] });
  if (pending === undefined || !PAGE_MINTED_ID.test(pending.noticeId)) {
    return undefined;
  }
  return consistentOrNone({ nowMs, state: { lastOffMs, lastToldMs, pending, stretchStartMs, toldInStretch } });
}

/**
 * A well-shaped state kept only when the fold could have reached it by now, since whatever is kept here decides what
 * the next sample says. Each field alone reading right is not enough: a count of one with no time told bought the
 * second at once on a reload, a time told still to come held every nudge off until it arrived, a pending second a
 * minute after the first was spoken as soon as the page came back, and a count of two in a fresh stretch silenced it.
 * What this does not close: a clock wound back past what was kept drops it like any contradiction, so a reload then
 * starts the cadence afresh and the server's hour (`./talkNoticeLedger.ts`) is all that holds what is spoken.
 *
 * @param state the fields as read
 * @param nowMs the instant it is read at
 * @returns the state, or `undefined` when its fields contradict each other or the clock
 */
function consistentOrNone({ state, nowMs }: { state: IsoStrayState; nowMs: number }): IsoStrayState | undefined {
  const { lastOffMs, lastToldMs, pending, stretchStartMs, toldInStretch } = state;
  if ([lastOffMs, lastToldMs, stretchStartMs].some((ms) => ms !== undefined && ms > nowMs)) {
    return undefined;
  }
  if (stretchStartMs === undefined || lastOffMs === undefined) {
    // Nothing running: an ended stretch keeps only when its newest nudge was told.
    const idle = stretchStartMs === undefined && lastOffMs === undefined && toldInStretch === 0;
    if (!idle || pending !== undefined) {
      return undefined;
    }
    return state;
  }
  if (lastOffMs < stretchStartMs || !toldFits({ lastToldMs, stretchStartMs, toldInStretch })) {
    return undefined;
  }
  if (pending === undefined) {
    return state;
  }
  // A nudge is minted on an off-ISO sample, which is the stretch's newest until a later one, so every wait it had to
  // clear before it was owed has to have elapsed by that newest sample too.
  const dwelt = lastOffMs - stretchStartMs >= ISO_STRAY_DWELL_MS;
  const waited = lastToldMs === undefined || lastOffMs - lastToldMs >= ISO_STRAY_AGAIN_MS;
  if (toldInStretch === 2 || !dwelt || !waited || pending.again !== (toldInStretch === 1)) {
    return undefined;
  }
  // The minutes it speaks were the stretch's length when it was minted, somewhere from the dwell to that newest sample.
  const fewest = Math.min(DRIFT_MAX_MINUTES, ISO_STRAY_DWELL_MS / 60_000);
  const most = Math.min(DRIFT_MAX_MINUTES, Math.floor((lastOffMs - stretchStartMs) / 60_000));
  if (pending.minutes < fewest || pending.minutes > most) {
    return undefined;
  }
  return state;
}

/**
 * Whether a running stretch's count agrees with when the newest nudge was told: none yet means that was before the
 * stretch began, one means after its dwell, and two means after the dwell and the hour after the first.
 *
 * @param lastToldMs when the newest nudge was told, across stretches
 * @param stretchStartMs when the running stretch began
 * @param toldInStretch nudges this stretch has had
 * @returns true when the fold could have left them so
 */
function toldFits({
  lastToldMs,
  stretchStartMs,
  toldInStretch,
}: {
  lastToldMs: number | undefined;
  stretchStartMs: number;
  toldInStretch: 0 | 1 | 2;
}): boolean {
  if (toldInStretch === 0) {
    return lastToldMs === undefined || lastToldMs <= stretchStartMs;
  }
  if (lastToldMs === undefined) {
    return false;
  }
  let earliestMs = stretchStartMs + ISO_STRAY_DWELL_MS;
  if (toldInStretch === 2) {
    earliestMs += ISO_STRAY_AGAIN_MS;
  }
  return lastToldMs >= earliestMs;
}
