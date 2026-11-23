/**
 * Fit a Slack read's WHOLE messages to the room one tool answer has — the shared core of `slack_open` and
 * `slack_thread_after`.
 *
 * Why: reading a long alerts thread, a voice that says its Slack reader still cuts both long messages and offers the
 * owner a fleet session to read them was handed an answer of 6.4 KB against a 16 KiB budget and the
 * page's 24 KiB tool cap, because every message had been cut at a fixed 1,200 characters BEFORE any budget was applied. So
 * this fits by SIZE, never by a per-message cap. Repro: `slopweaver talk slack-open --url
 * https://acme.slack.com/archives/C0SYN000006/p1792418951814379 --json`.
 *
 * The order is the reader's: the priority message (a thread's opening, or the linked one) first, then the newest
 * messages whole. The first that does not fit whole is cut to the room left — never skipped to admit smaller older
 * ones — and named in `cut`, so the voice can say exactly which message it could not read to its end. Every size is
 * the message's own serialised UTF-8 bytes, so JSON escaping is counted rather than estimated, and a cut falls between
 * graphemes, so it never splits an emoji, a flag or a surrogate pair.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type SlackAnswerOverCeilingError, TalkErrors } from "./errors.js";
import { PAGE_TOOL_ANSWER_MAX_BYTES } from "./pageOutline.js";
import type { SpokenSlackMessage } from "./slackAfter.js";

/** The fewest characters a cut message keeps; a shorter prefix says nothing, so that message is left out instead. */
export const MIN_PARTIAL_CHARACTERS = 80;

/** Splits a message's words into what a reader sees as one character each. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Room the page keeps for what it adds to a read's answer after the verb printed it: `slack_open`'s
 * `notOnOwnerScreen` sentence (`site/lib/slackThreadsShown.ts`) carries a link of up to 2,000 characters
 * (`site/lib/slots.ts`) beside ~280 of its own, and JSON may escape every one of them to two bytes.
 */
const PAGE_WRAPPER_RESERVE_BYTES = 5 * 1024;

/** The most UTF-8 bytes a Slack read's whole serialised answer takes, so the page's additions still fit its cap. */
export const SLACK_READ_ANSWER_MAX_BYTES = PAGE_TOOL_ANSWER_MAX_BYTES - PAGE_WRAPPER_RESERVE_BYTES;

/** What a cut message's text ends with, so the cut is visible in the words themselves. */
const CUT_MARK = " …";

/** One message the read could not carry whole: who, when, and how much of it is here. */
export interface SlackMessageCut {
  readonly author: string;
  readonly atIso: string;
  /** Characters (graphemes) of the message's own words that are carried. */
  readonly keptChars: number;
  /** Characters (graphemes) in the whole message. */
  readonly wholeChars: number;
}

/** What one fit kept. */
export interface SlackMessageFit<T extends SpokenSlackMessage> {
  /** The priority message, whole or cut; `null` when there was none or not even a cut of it fits. */
  readonly priority: T | null;
  /** The newest of the rest that fit, oldest first; the oldest of them may be a cut one. */
  readonly messages: readonly T[];
  /** Every message carried only in part, the priority first — a priority with no room for even a cut keeps 0. */
  readonly cut: readonly SlackMessageCut[];
  /** Messages of the rest left out entirely — always the OLDEST. A cut message is carried, so never counted here. */
  readonly omitted: number;
  /** The carried messages' serialised UTF-8 bytes, array commas included — at most the budget, often under it. */
  readonly usedBytes: number;
}

/**
 * Fit a priority message and the rest of a read into a byte budget.
 *
 * @param priority the message kept before any other, or `null`
 * @param messages the rest, oldest first
 * @param maxBytes the ceiling on every carried message's serialised UTF-8 bytes, array commas included
 * @param minimumPartialCharacters the fewest characters a cut message keeps before it is left out instead
 * @returns what was kept, what was cut and how many were left out
 */
export function fitSlackMessages<T extends SpokenSlackMessage>({
  priority,
  messages,
  maxBytes,
  minimumPartialCharacters,
}: {
  priority: T | null;
  messages: readonly T[];
  maxBytes: number;
  minimumPartialCharacters: number;
}): SlackMessageFit<T> {
  const first = fitPriority({ maxBytes, minimumPartialCharacters, priority });
  const cuts: SlackMessageCut[] = [...first.cut];
  let room = maxBytes - first.bytes;
  const kept: T[] = [];
  for (const message of messages.toReversed()) {
    // One comma separates each carried message from the one before it.
    const separator = kept.length === 0 ? 0 : 1;
    const fitted = fitOne({ message, minimumPartialCharacters, room: room - separator });
    if (fitted === null) {
      break;
    }
    kept.push(fitted.message);
    room -= fitted.bytes + separator;
    if (fitted.cut !== null) {
      cuts.push(fitted.cut);
      break;
    }
  }
  return {
    cut: cuts,
    messages: kept.toReversed(),
    omitted: messages.length - kept.length,
    priority: first.message,
    usedBytes: maxBytes - room,
  };
}

/** The priority message fitted first, with the bytes it took and its cut, if it was cut; nothing when there was none. */
function fitPriority<T extends SpokenSlackMessage>({
  priority,
  maxBytes,
  minimumPartialCharacters,
}: {
  priority: T | null;
  maxBytes: number;
  minimumPartialCharacters: number;
}): { readonly message: T | null; readonly bytes: number; readonly cut: readonly SlackMessageCut[] } {
  if (priority === null) {
    return { bytes: 0, cut: [], message: null };
  }
  const fitted = fitOne({ message: priority, minimumPartialCharacters, room: maxBytes });
  if (fitted === null) {
    // Not even a cut fits, so it is named with none of its words here — never dropped unsaid.
    const wholeChars = Array.from(GRAPHEMES.segment(priority.text)).length;
    return {
      bytes: 0,
      cut: [{ atIso: priority.atIso, author: priority.author, keptChars: 0, wholeChars }],
      message: null,
    };
  }
  if (fitted.cut === null) {
    return { bytes: fitted.bytes, cut: [], message: fitted.message };
  }
  return { bytes: fitted.bytes, cut: [fitted.cut], message: fitted.message };
}

/** A message's serialised size, in UTF-8 bytes. */
function bytesOf({ message }: { message: SpokenSlackMessage }): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

/**
 * One message whole when it fits, else the longest grapheme prefix that does, marked; `null` when not even
 * {@link MIN_PARTIAL_CHARACTERS} of it would.
 */
function fitOne<T extends SpokenSlackMessage>({
  message,
  room,
  minimumPartialCharacters,
}: {
  message: T;
  room: number;
  minimumPartialCharacters: number;
}): { readonly message: T; readonly bytes: number; readonly cut: SlackMessageCut | null } | null {
  const whole = bytesOf({ message });
  if (whole <= room) {
    return { bytes: whole, cut: null, message };
  }
  const characters = Array.from(GRAPHEMES.segment(message.text), (part) => part.segment);
  const prefixed = ({ count }: { count: number }): T => ({
    ...message,
    text: `${characters.slice(0, count).join("")}${CUT_MARK}`,
  });
  // Serialised size only grows as characters are added, so the longest prefix that fits is a binary search.
  let low = 0;
  let high = characters.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytesOf({ message: prefixed({ count: middle }) }) <= room) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const candidate = prefixed({ count: low });
  const bytes = bytesOf({ message: candidate });
  if (low < minimumPartialCharacters || bytes > room) {
    return null;
  }
  return {
    bytes,
    cut: { atIso: message.atIso, author: message.author, keptChars: low, wholeChars: characters.length },
    message: candidate,
  };
}

/**
 * Build a read's answer at the largest message budget whose WHOLE serialised answer fits a byte ceiling. The
 * message budget alone does not bound the answer — its sentence, `people`, `warnings` and `cut` ride beside the
 * messages — and the page refuses an over-cap answer whole, so the budget shrinks below what the messages actually
 * used by each overshoot until it fits. Every pass shrinks it, so this ends.
 *
 * @param build the answer at one message budget, in UTF-8 bytes, with the bytes its messages actually used
 * @param maxBytes the message budget to start from
 * @param ceilingBytes the ceiling on the whole serialised answer, in the UTF-8 bytes the page counts
 * @returns the answer, or why not even an answer with no message in it fits
 */
export function fitAnswer<T>({
  build,
  maxBytes,
  ceilingBytes,
}: {
  build: (args: { budget: number }) => { readonly answer: T; readonly usedBytes: number };
  maxBytes: number;
  ceilingBytes: number;
}): Result<T, SlackAnswerOverCeilingError> {
  let budget = maxBytes;
  for (;;) {
    const { answer, usedBytes } = build({ budget });
    const bytes = Buffer.byteLength(JSON.stringify(answer), "utf8");
    if (bytes <= ceilingBytes) {
      return ok(answer);
    }
    if (budget === 0) {
      return err(TalkErrors.slackAnswerOverCeiling({ bytes, ceilingBytes }));
    }
    budget = Math.max(Math.min(budget, usedBytes) - (bytes - ceilingBytes), 0);
  }
}

/**
 * The clause an answer sentence carries for its cut messages, naming each by author and time.
 *
 * @param cut the messages carried only in part
 * @returns the clause, opening with a space, or `""` when nothing was cut
 */
export function cutClause({ cut }: { cut: readonly SlackMessageCut[] }): string {
  if (cut.length === 0) {
    return "";
  }
  const named = cut.map(
    (one) =>
      `${one.author}'s at ${one.atIso} (${String(one.keptChars)} of ${String(one.wholeChars)} characters are here)`,
  );
  return ` Too long to carry whole in one answer, so cut: ${named.join("; ")}.`;
}
