/**
 * The one notice the page posts when the owner has strayed off ISO in work hours with an ISO card waiting on them
 * (`../app/api/talk/call/[id]/iso-nudge/route.ts`), bounded here so the route, the watch and the spoken line share one
 * shape. The nudge reminds the owner that the ISO work still has items waiting on them.
 *
 * It carries the ONE card it names (one concrete thing, never "ISO" in the abstract), how long
 * the stretch has run and whether this is the second nudge, and nothing else: no window title, no application name and
 * no other Queue row ever leaves the page ([why](../../docs/console/voice-nudges-iso.md)).
 */
import { isBag } from "./bag";
import { boundedDriftField, DRIFT_MAX_MINUTES, DRIFT_NOTICE_ID_MAX_CHARS } from "./driftNotice";

/** The longest card subject a notice carries: it is spoken inside one sentence. */
export const ISO_ITEM_SUBJECT_MAX_CHARS = 100;

/** The longest card key a notice carries: `<kind>:<id>`, with room. */
export const ISO_ITEM_KEY_MAX_CHARS = 200;

/** The ISO card a nudge names: its Queue key, for the log, and its subject, for the line. */
export interface IsoNudgeItem {
  readonly key: string;
  readonly subject: string;
}

/** One nudge, as the page posts it and the server says it. */
export interface IsoNudgeNotice {
  /** Minted once per nudge and kept through every retry, so the line is said once. */
  readonly noticeId: string;
  readonly item: IsoNudgeItem;
  /** Whole minutes the off-ISO stretch has run, at least the dwell. */
  readonly minutes: number;
  /** True on the stretch's second nudge, the last it ever gets. */
  readonly again: boolean;
}

/** Every Unicode quotation mark, read as the apostrophe it usually is in a subject ("Acme's"). */
const QUOTE_MARKS = /\p{Quotation_Mark}/gu;

/**
 * Anything a subject keeps besides: letters, digits, combining marks, spaces, the apostrophe and plain punctuation. An
 * allowlist rather than a list of quote-like marks, since an ornament no list named could still close the quoted name.
 */
const NOT_SPOKEN = /[^\p{L}\p{N}\p{M} '.,:;!?&/()#+%@_-]/gu;

/**
 * A Queue card as a nudge may name it: key and subject bounded exactly as the route will read them, so the line the
 * server speaks is the subject the page chose. The line quotes the subject, and a mark that could close that quote
 * could speak words outside it, an instruction or a second card: so every quotation mark becomes an apostrophe, and
 * every other character outside {@link NOT_SPOKEN}'s allowlist a space.
 *
 * @param key the card's Queue key
 * @param subject the card's subject as the Queue draws it
 * @returns the item, or `undefined` when either is empty once cleaned
 */
export function isoNudgeItemOf({ key, subject }: { key: unknown; subject: unknown }): IsoNudgeItem | undefined {
  const boundedKey = boundedDriftField({ maxChars: ISO_ITEM_KEY_MAX_CHARS, value: key });
  let spoken: unknown = subject;
  if (typeof subject === "string") {
    spoken = subject.replace(QUOTE_MARKS, "'").replace(NOT_SPOKEN, " ");
  }
  const boundedSubject = boundedDriftField({ maxChars: ISO_ITEM_SUBJECT_MAX_CHARS, value: spoken });
  if (boundedKey === undefined || boundedSubject === undefined) {
    return undefined;
  }
  return { key: boundedKey, subject: boundedSubject };
}

/** The keys a post carries, exactly: a surplus field is refused rather than dropped, so nothing else rides along. */
const NOTICE_KEYS = ["again", "item", "minutes", "noticeId"];
const ITEM_KEYS = ["key", "subject"];

/**
 * Whether a bag carries exactly these keys.
 *
 * @param bag the parsed object
 * @param keys the allowed keys, sorted
 * @returns true when it carries those and no others
 */
function hasExactly({ bag, keys }: { bag: Record<string, unknown>; keys: readonly string[] }): boolean {
  const own = Object.keys(bag).toSorted();
  return own.length === keys.length && own.every((key, at) => key === keys[at]);
}

/**
 * A notice read from a post, strictly: exactly its four fields and the item's two, every one present and bounded,
 * minutes a whole number in range, `again` a boolean.
 *
 * @param value the post's parsed body
 * @returns the notice, or `undefined` for anything else
 */
export function isoNudgeNoticeOf({ value }: { value: unknown }): IsoNudgeNotice | undefined {
  if (!isBag(value) || !isBag(value["item"])) {
    return undefined;
  }
  if (!hasExactly({ bag: value, keys: NOTICE_KEYS }) || !hasExactly({ bag: value["item"], keys: ITEM_KEYS })) {
    return undefined;
  }
  const noticeId = boundedDriftField({ maxChars: DRIFT_NOTICE_ID_MAX_CHARS, value: value["noticeId"] });
  const item = isoNudgeItemOf({ key: value["item"]["key"], subject: value["item"]["subject"] });
  const { minutes, again } = value;
  const minutesOk =
    typeof minutes === "number" && Number.isSafeInteger(minutes) && minutes > 0 && minutes <= DRIFT_MAX_MINUTES;
  if (noticeId === undefined || item === undefined || !minutesOk || typeof again !== "boolean") {
    return undefined;
  }
  return { again, item, minutes, noticeId };
}
