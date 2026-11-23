/**
 * A triage pass kept across a reload — pure: the pass in, the text kept for it out, and back.
 *
 * A reload ends the call for good (`../components/voice/VoiceProvider.tsx`), and the pass lived in the page, so "it's
 * triaging time" on the next call began again from the first card the owner had already ruled. So the page keeps the pass in
 * `localStorage` on every change (`../components/voice/useTriageWalk.ts`) and reads it back when the provider mounts.
 * {@link TRIAGE_PASS_IDLE_MS}, unchanged, still decides when a kept pass is too old to pick up.
 *
 * Read back strictly: one field off shape and the whole pass is dropped, so the next "triaging time" starts a fresh
 * one rather than ruling a card off a guessed pass.
 */
import { isBag } from "./bag";
import { CARD_KEY } from "./cardKey";
import { triageVisitIdOf } from "./triageWalk";
import type { TriageOut, TriageRuled, TriageSettled, TriageVisit, TriageWalk } from "./triageWalkTypes";
import { triageLabelOf, triageVerdictOf } from "./triageWords";

/** The `localStorage` key the pass is kept under, one per browser. */
export const TRIAGE_WALK_KEY = "slopweaver.triage-walk";

/**
 * Whether a `storage` event from another tab may have changed the kept pass: a write to its key, or the whole store
 * cleared, which the event reports with no key. A page that cached the pass on an earlier turn reads it again before
 * its next use, so a pass another tab kept since is resumed rather than started over.
 *
 * @param key the event's key, `null` when the store was cleared
 * @returns whether the page must read the kept pass again
 */
export function keptTriageWalkChanged({ key }: { key: string | null }): boolean {
  return key === null || key === TRIAGE_WALK_KEY;
}

/** A pass id's shape: the page's UUID. */
const WALK_ID = /^[0-9a-f-]{36}$/u;

/**
 * Whether a value is a list whose every element reads as `T`.
 *
 * @param value anything
 * @param read one element's reader, `undefined` when it does not read
 * @returns the list, or `undefined` when it is not one or an element does not read
 */
function listOf<T>({ value, read }: { value: unknown; read: (entry: unknown) => T | undefined }): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: T[] = [];
  for (const entry of value) {
    const one = read(entry);
    if (one === undefined) {
      return undefined;
    }
    out.push(one);
  }
  return out;
}

/**
 * A card key, or `undefined` when the value is not one.
 *
 * @param value anything
 * @returns the key
 */
function cardKeyOf({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && CARD_KEY.test(value) ? value : undefined;
}

/**
 * One kept visit, or `undefined` when it does not read.
 *
 * @param value a kept visit
 * @returns the visit
 */
function visitOf({ value }: { value: unknown }): TriageVisit | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const { arrived, fingerprint, opened, presentedMs, rewritten, ruled } = value;
  const visitId = triageVisitIdOf({ value: value["visitId"] });
  const key = cardKeyOf({ value: value["key"] });
  const flags = [arrived, opened, rewritten, ruled];
  if (
    visitId === undefined ||
    key === undefined ||
    typeof fingerprint !== "string" ||
    typeof presentedMs !== "number" ||
    !Number.isFinite(presentedMs) ||
    !flags.every((flag) => typeof flag === "boolean")
  ) {
    return undefined;
  }
  return {
    arrived: arrived === true,
    fingerprint,
    key,
    opened: opened === true,
    presentedMs,
    rewritten: rewritten === true,
    ruled: ruled === true,
    visitId,
  };
}

/**
 * A kept visit slot: absent is no card, anything else must read.
 *
 * @param value the slot's kept value
 * @returns the visit, `undefined` for none, or `false` when it is there and does not read
 */
function slotOf({ value }: { value: unknown }): TriageVisit | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  const visit = visitOf({ value });
  if (visit === undefined) {
    return false;
  }
  return visit;
}

/**
 * One kept ruling, or `undefined` when it does not read.
 *
 * @param entry a kept ruling
 * @returns the ruling
 */
function ruledOf(entry: unknown): TriageRuled | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const key = cardKeyOf({ value: entry["key"] });
  const verdict = triageVerdictOf({ value: entry["verdict"] });
  const label = triageLabelOf({ value: entry["label"] });
  if (key === undefined || verdict === undefined || (entry["label"] !== undefined && label === undefined)) {
    return undefined;
  }
  return { key, label, verdict };
}

/**
 * One kept card out for rewrite, or `undefined` when it does not read.
 *
 * @param entry a kept card out for rewrite
 * @returns the card
 */
function outOf(entry: unknown): TriageOut | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const key = cardKeyOf({ value: entry["key"] });
  const { fingerprint, seenGone } = entry;
  if (key === undefined || typeof fingerprint !== "string" || typeof seenGone !== "boolean") {
    return undefined;
  }
  return { fingerprint, key, seenGone };
}

/**
 * One kept card the owner ruled, with the words it was ruled on, or `undefined` when it does not read.
 *
 * @param entry a kept settled card
 * @returns the card
 */
function settledOf(entry: unknown): TriageSettled | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const key = cardKeyOf({ value: entry["key"] });
  const { fingerprint } = entry;
  if (key === undefined || typeof fingerprint !== "string") {
    return undefined;
  }
  return { fingerprint, key };
}

/**
 * One kept board tag of the owner's focus, or `undefined` when it is not a string.
 *
 * @param entry one element
 * @returns the tag
 */
function focusEntry(entry: unknown): string | undefined {
  return typeof entry === "string" ? entry : undefined;
}

/**
 * A kept stop instant: absent while the pass runs, anything else must be a finite number.
 *
 * @param value the kept `stoppedMs`
 * @returns the instant, `undefined` for a running pass, or `false` when it is there and does not read
 */
function stoppedOf({ value }: { value: unknown }): number | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : false;
}

/**
 * A card key list, read as {@link cardKeyOf} reads each.
 *
 * @param entry one element
 * @returns the key, or `undefined`
 */
function keyEntry(entry: unknown): string | undefined {
  return cardKeyOf({ value: entry });
}

/**
 * The pass a kept text holds, or `undefined` when nothing is kept or any of it does not read.
 *
 * @param raw what `localStorage` holds under {@link TRIAGE_WALK_KEY}, `null` when nothing
 * @returns the pass as it was kept
 */
export function keptTriageWalkOf({ raw }: { raw: string | null }): TriageWalk | undefined {
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isBag(parsed)) {
    return undefined;
  }
  const { walkId, visits, touchedMs, paused } = parsed;
  const order = listOf({ read: keyEntry, value: parsed["order"] });
  const shown = listOf({ read: keyEntry, value: parsed["shown"] });
  const focus = listOf({ read: focusEntry, value: parsed["focus"] });
  const rulings = listOf({ read: ruledOf, value: parsed["rulings"] });
  const settled = listOf({ read: settledOf, value: parsed["settled"] });
  const out = listOf({ read: outOf, value: parsed["out"] });
  const current = slotOf({ value: parsed["current"] });
  const previous = slotOf({ value: parsed["previous"] });
  const stoppedMs = stoppedOf({ value: parsed["stoppedMs"] });
  if (
    typeof walkId !== "string" ||
    !WALK_ID.test(walkId) ||
    typeof visits !== "number" ||
    !Number.isInteger(visits) ||
    visits < 0 ||
    typeof touchedMs !== "number" ||
    !Number.isFinite(touchedMs) ||
    typeof paused !== "boolean" ||
    order === undefined ||
    shown === undefined ||
    focus === undefined ||
    rulings === undefined ||
    settled === undefined ||
    out === undefined ||
    current === false ||
    previous === false ||
    stoppedMs === false
  ) {
    return undefined;
  }
  return {
    current,
    focus,
    order,
    out,
    paused,
    previous,
    rulings,
    settled,
    shown,
    stoppedMs,
    touchedMs,
    visits,
    walkId,
  };
}

/**
 * The text a pass is kept as.
 *
 * @param walk the pass
 * @returns its JSON
 */
export function keptTriageWalkText({ walk }: { walk: TriageWalk }): string {
  return JSON.stringify(walk);
}

/**
 * A kept pass as a new call after a reload holds it: stopped, exactly as `triage_end` leaves one, so "triaging time"
 * picks it up (`resumeTriageWalk`) while it is inside {@link TRIAGE_PASS_IDLE_MS} and a stale relay lands nowhere. A
 * pass still running when the page went stops at the instant a card was last put in front of the owner, so it is
 * judged idle from exactly where it was. The cards in front of them and just before belonged to answers that are over,
 * so neither is held; and a card they had in front of them and did not rule is taken back out of the cards seen, so
 * the next `triage_next` puts it in front of them again rather than walking past a card the reload took off their
 * screen. One sent back and back again goes out for rewrite again, already back: the first ruling settled the words
 * it was sent back on, so as a card seen it would be walked past whenever it came back with those same words. Every
 * ruling, every card seen and every card out for rewrite stands, and so does a paused clock: the owner said when it
 * starts again.
 *
 * @param walk the pass as it was kept
 * @returns the pass to hold on the new page
 */
export function reloadedTriageWalk({ walk }: { walk: TriageWalk }): TriageWalk {
  const unruled = walk.current !== undefined && !walk.current.ruled ? walk.current : undefined;
  let stoppedMs = walk.touchedMs;
  if (walk.stoppedMs !== undefined) {
    stoppedMs = walk.stoppedMs;
  }
  let { out } = walk;
  if (unruled !== undefined && unruled.rewritten && !out.some((one) => one.key === unruled.key)) {
    out = [...out, { fingerprint: unruled.fingerprint, key: unruled.key, seenGone: true }];
  }
  return {
    ...walk,
    current: undefined,
    out,
    previous: undefined,
    shown: walk.shown.filter((key) => key !== unruled?.key),
    stoppedMs,
  };
}
