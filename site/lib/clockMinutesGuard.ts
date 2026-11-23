/**
 * Whether a clock length the model passed is one the owner named: the voice never picks a number for the owner's clock,
 * so `minutes` on `triage_next` or `triage_clock` stands only when the
 * owner's newest words say that number — as digits ("10"), as words ("ten", "twenty-five", "a hundred and ten"), in
 * hours ("two hours", "an hour and a half"), or as "half an hour" or "a quarter of an hour".
 *
 * The page judges the owner's words, as `./triageAskGuard.ts` does for an ask to triage, and refuses when unsure: the
 * voice then leaves `minutes` out and the card's own default runs. The bound, stated rather than discovered: a number
 * the owner said about something else inside the window passes ("ten cards left, give me one on this" lets 10 through),
 * and a length worded outside these shapes refuses until the owner rewords it. Each length is read at its longest, so a
 * shorter spelling inside a longer one ("an hour" in "half an hour", "ten" in "one hundred and ten") never counts as
 * said, and a length past the clock's cap is still read whole so its last word never passes alone.
 */
import type { GateEntry } from "./relayGate";
import { heardOwnerWords, TRIAGE_ASK_WINDOW } from "./triageAskGuard";
import { clockMinutesValid, TRIAGE_CLOCK_MINUTES_MAX } from "./triageWalkClock";

/** Each number word up to twenty, by value. */
const UNITS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

/** Each tens word, by its tens digit. */
const TENS: Readonly<Record<number, string>> = {
  2: "twenty",
  3: "thirty",
  4: "forty",
  5: "fifty",
  6: "sixty",
  7: "seventy",
  8: "eighty",
  9: "ninety",
};

/**
 * The largest number spelled. Past the clock's own cap on purpose: a length the owner says above it must be READ
 * whole, so its last word ("ten" in "one hundred and ten", "three" in "three hours") never passes alone; it then
 * names a length the clock refuses as malformed.
 */
const SPELLED_MAX = 999;

/** The phrases that name a length without a number. */
const PHRASES: readonly { readonly spelling: string; readonly minutes: number }[] = [
  { minutes: 15, spelling: "quarter of an hour" },
  { minutes: 15, spelling: "quarter hour" },
  { minutes: 30, spelling: "half an hour" },
  { minutes: 30, spelling: "half hour" },
  { minutes: 60, spelling: "an hour" },
  { minutes: 90, spelling: "an hour and a half" },
  { minutes: 90, spelling: "hour and a half" },
];

/**
 * A number's words, every way it is commonly said: "twenty-five" and "twenty five", "one hundred and ten", "a hundred
 * ten".
 *
 * @param n the number, from 1 to {@link SPELLED_MAX}
 * @returns each wording, lowercased
 */
function numberWords({ n }: { n: number }): readonly string[] {
  if (n < UNITS.length) {
    return [UNITS[n]];
  }
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const unit = n % 10;
    if (unit === 0) {
      return [tens];
    }
    return [`${tens}-${UNITS[unit]}`, `${tens} ${UNITS[unit]}`];
  }
  const hundreds = Math.floor(n / 100);
  const heads = hundreds === 1 ? ["one hundred", "a hundred"] : [`${UNITS[hundreds]} hundred`];
  const rest = n % 100;
  if (rest === 0) {
    return heads;
  }
  const tails = numberWords({ n: rest });
  return heads.flatMap((head) => tails.flatMap((tail) => [`${head} and ${tail}`, `${head} ${tail}`]));
}

/**
 * A number's digits and its words.
 *
 * @param n the number
 * @returns each spelling
 */
function numberSpellings({ n }: { n: number }): readonly string[] {
  return [String(n), ...numberWords({ n })];
}

/** Every number spelled, from 1 up. */
const NUMBERS: readonly number[] = Array.from({ length: SPELLED_MAX }, (_, at) => at + 1);

/** Every spelling of every length read, with the minutes it names: a number, a number of hours, and each phrase. */
const ALL_SPELLINGS: readonly { readonly spelling: string; readonly minutes: number }[] = [
  ...NUMBERS.flatMap((n) => numberSpellings({ n }).map((spelling) => ({ minutes: n, spelling }))),
  ...NUMBERS.flatMap((hours) =>
    numberSpellings({ n: hours }).flatMap((said) => [
      { minutes: hours * 60, spelling: `${said} hour` },
      { minutes: hours * 60, spelling: `${said} hours` },
      { minutes: hours * 60 + 30, spelling: `${said} and a half hours` },
    ]),
  ),
  ...PHRASES,
];

/**
 * Every way the owner may say a number of minutes the clock takes: its digits, its words, a number of hours, and any
 * phrase that names it.
 *
 * @param minutes the number
 * @returns each spelling, lowercased
 */
export function minuteSpellings({ minutes }: { minutes: number }): readonly string[] {
  return ALL_SPELLINGS.filter((entry) => entry.minutes === minutes).map((entry) => entry.spelling);
}

/** One place a spelling stands whole in the text: its span and the minutes it names. */
interface SpokenLength {
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
}

/**
 * Every place a spelling stands as its own word or phrase in the text, never inside a longer word ("ten" in "often",
 * "10" in "100").
 *
 * @param text the owner's words
 * @param spelling one spelling of the number
 * @param minutes the number it spells
 * @returns each span it stands whole at
 */
function wholeSpans({ text, spelling, minutes }: { text: string; spelling: string; minutes: number }): SpokenLength[] {
  const spans: SpokenLength[] = [];
  let from = text.indexOf(spelling);
  while (from !== -1) {
    const end = from + spelling.length;
    if (!/[a-z0-9-]/u.test(text.charAt(from - 1)) && !/[a-z0-9-]/u.test(text.charAt(end))) {
      spans.push({ end, minutes, start: from });
    }
    from = text.indexOf(spelling, from + 1);
  }
  return spans;
}

/**
 * The lengths the text names, each read at its longest: a spelling a longer one the owner said overlaps is not said on
 * its own, so "half an hour" names 30 and never 60, "twenty five" names 25 and never 5, "two hours" never 2, and
 * "1 hour and a half" names 90 and never 60.
 *
 * @param text the owner's words, normalised
 * @returns the minutes of every length named
 */
export function spokenMinutes({ text }: { text: string }): ReadonlySet<number> {
  const spans = ALL_SPELLINGS.flatMap(({ spelling, minutes }) => wholeSpans({ minutes, spelling, text }));
  const outread = ({ span, other }: { span: SpokenLength; other: SpokenLength }): boolean =>
    other.start < span.end && span.start < other.end && other.end - other.start > span.end - span.start;
  return new Set(spans.filter((span) => !spans.some((other) => outread({ other, span }))).map((span) => span.minutes));
}

/**
 * Whether the owner's newest words — the last {@link TRIAGE_ASK_WINDOW} characters of what they were heard saying, or
 * typed — name this number of minutes, read at its longest ({@link spokenMinutes}).
 *
 * @param log the call's relay-gate record, read for what the owner was actually heard saying
 * @param minutes the length the model passed
 * @returns true only when the owner's newest words say that number
 */
export function heardClockMinutes({ log, minutes }: { log: readonly GateEntry[]; minutes: number }): boolean {
  const heard = heardOwnerWords({ log });
  const newest = heard.slice(Math.max(0, heard.length - TRIAGE_ASK_WINDOW));
  return spokenMinutes({ text: newest }).has(minutes);
}

/** What the page tells the model when the owner did not name the length it passed. */
export const CLOCK_MINUTES_NOT_SAID =
  "The owner did not name that length in their own words: never pick a number for their clock. Call it again " +
  "without minutes, so the card's own default runs, or ask them how long they want.";

/** What the page tells the model when `minutes` is not a whole number of minutes in range. */
export const CLOCK_MINUTES_MALFORMED = `minutes must be a whole number from 1 to ${String(TRIAGE_CLOCK_MINUTES_MAX)}`;

/**
 * The clock length a tool call carries, checked: absent is the card's own default, and a present one must be a whole
 * number in range that the owner's newest words name.
 *
 * @param args the tool call's arguments
 * @param log the call's relay-gate record
 * @returns the owner's minutes (`undefined` for none), or why the length is refused
 */
export function ownerMinutesOf({
  args,
  log,
}: {
  args: Readonly<Record<string, unknown>>;
  log: readonly GateEntry[];
}):
  | { readonly kind: "named"; readonly minutes: number | undefined }
  | { readonly kind: "refused"; readonly why: string } {
  const minutes = args["minutes"];
  if (minutes === undefined) {
    return { kind: "named", minutes: undefined };
  }
  if (!clockMinutesValid(minutes)) {
    return { kind: "refused", why: CLOCK_MINUTES_MALFORMED };
  }
  if (!heardClockMinutes({ log, minutes })) {
    return { kind: "refused", why: CLOCK_MINUTES_NOT_SAID };
  }
  return { kind: "named", minutes };
}
