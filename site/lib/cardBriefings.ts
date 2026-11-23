/**
 * The briefings a Queue card links, as `read_card` and `open_card` hand them to the voice: each one already read
 * for it, or the exact sentence to say instead. Which briefings a card links is `./briefingAddresses.ts`.
 *
 * The most useful thing is to read everything and never distort; the second most useful is honesty about a
 * briefing that could not be opened, and reading happens without asking when a queue card opens. So the runner,
 * never the model, reads every briefing a card links (`../components/voice/cardBriefingRead.ts`), and a briefing it could
 * not read comes back carrying the sentence that says so, which the tool's description has the model say word
 * for word (`src/talk/cardToolSchemas.ts`).
 *
 * The answer has to fit the page's 24 KiB tool cap (`../components/live/talkSession.ts` `TOOL_OUTPUT_MAX`),
 * which refuses an answer over it WHOLE. {@link withFittedBriefings} fits it under {@link CARD_ANSWER_MAX_BYTES}
 * by cutting briefing text, and a cut one carries `rest`, where `file_read`'s words mode reads on to its end before the
 * voice speaks; a briefing it cannot name at all is counted and said. A read that failed — the Queue tool's deadline
 * included — for a briefing whose file the card names carries `rest` from the top and nothing else, so the voice reads
 * it itself before it ever says it could not. Pure.
 */
import type { BriefingRead } from "./briefingRead";

/**
 * Where the rest of a partial briefing is read from: `file_read` with `words: true` at `path` from `from`, a byte
 * offset into the page's WORDS (`src/talk/pageWordsRead.ts`). The voice reads entire briefings even if it takes
 * multiple reads; saying a sentence instead and guessing a raw-markup offset would skip part of the page.
 */
export interface BriefingRest {
  readonly path: string;
  readonly from: number;
}

/** One briefing a card links, as the voice is handed it. */
export type CardBriefing =
  | { readonly slug: string; readonly read: true; readonly text: string }
  | {
      readonly slug: string;
      readonly read: "partial";
      readonly text: string;
      readonly say: string;
      readonly rest: BriefingRest;
    }
  | { readonly slug: string; readonly read: false; readonly why: string; readonly say: string };

/** Where a read briefing's words came from: its page's file, and whether masking changed their length. */
interface BriefingSource {
  readonly path: string;
  readonly masked: boolean;
}

/**
 * One briefing as read, before it is fitted into a card's answer: a read one keeps its {@link BriefingSource}, so a
 * cut can say where the rest starts, and the fit strips it so a whole briefing costs the answer nothing extra.
 */
export type ReadCardBriefing =
  | (Extract<CardBriefing, { read: true }> & { readonly source: BriefingSource })
  | (Extract<CardBriefing, { read: "partial" }> & { readonly source: BriefingSource })
  | Extract<CardBriefing, { read: false }>;

/**
 * The most UTF-8 bytes a whole card answer may serialise to: the page's 24 KiB cap less the 4 KiB of headroom
 * `./actionItemsFit.ts` keeps for the wrapper the delivery adds around it.
 */
export const CARD_ANSWER_MAX_BYTES = 20 * 1024;

/**
 * The sentence the voice says for a briefing it could not open — the owner's own words for it.
 *
 * @param slug the briefing's page name
 * @returns the sentence
 */
export function couldNotOpenSay({ slug }: { slug: string }): string {
  return `I couldn't open the ${slug} briefing, so I can't read that to you.`;
}

/**
 * The sentence the voice says for a briefing it was handed only the first part of, and whose rest it then failed to
 * read through `file_read` from the briefing's {@link BriefingRest}.
 *
 * @param slug the briefing's page name
 * @returns the sentence
 */
export function firstPartOnlySay({ slug }: { slug: string }): string {
  return `I could only read the first part of the ${slug} briefing.`;
}

/**
 * One briefing as read, off what reading it came to: read whole, read in part with where the rest starts and the
 * sentence for a rest that will not read, or not read with the sentence that says THAT. A part the verb stopped at
 * resumes at the verb's own `nextFrom`, which counts the words before the window was masked, so it is exact either way.
 *
 * A read that failed for a briefing whose file the card names is handed on as a part with nothing carried, its rest
 * the whole page from the top, so the voice reads it through `file_read` and says {@link couldNotOpenSay} only if that
 * fails too. MEASURED: the Queue tool's deadline ran out on a 12,941-byte briefing and the voice told the owner it
 * could not read it, then read it whole in two `file_read` windows seconds later (repro: `grep '"read_card"'` in
 * `$SLOPWEAVER_HOME/talk/calls/*.jsonl`).
 *
 * @param slug the briefing's page name
 * @param read what the briefing route answered
 * @param file the briefing's absolute file off the card's own address, `undefined` when the card names none
 * @returns the briefing, its source kept for the fit
 */
export function cardBriefingOf({
  slug,
  read,
  file,
}: {
  slug: string;
  read: BriefingRead;
  file: string | undefined;
}): ReadCardBriefing {
  if (!read.ok && file !== undefined) {
    const source = { masked: false, path: file };
    return { read: "partial", rest: { from: 0, path: file }, say: couldNotOpenSay({ slug }), slug, source, text: "" };
  }
  if (!read.ok) {
    return { read: false, say: couldNotOpenSay({ slug }), slug, why: read.why };
  }
  const source = { masked: read.masked, path: read.path };
  if (read.nextFrom !== null) {
    const rest = { from: read.nextFrom, path: read.path };
    return { read: "partial", rest, say: firstPartOnlySay({ slug }), slug, source, text: read.text };
  }
  return { read: true, slug, source, text: read.text };
}

/**
 * The briefing route's answer as a read, or the reason it is not one — a body of any other shape, a success missing
 * where its rest starts included, is a failed read, never a silent pass.
 *
 * @param body the route's parsed JSON
 * @returns the read
 */
export function briefingReadFromBody({ body }: { body: unknown }): BriefingRead {
  if (typeof body !== "object" || body === null) {
    return { ok: false, why: "the briefing route answered something that is not a read" };
  }
  const bag: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(body));
  const { ok, text, whole, why, path, masked, nextFrom } = bag;
  const resumesAt = restOffsetOf({ nextFrom });
  const shaped = typeof text === "string" && typeof path === "string" && typeof masked === "boolean";
  if (ok === true && shaped && resumesAt !== undefined && whole === (resumesAt === null)) {
    return { masked, nextFrom: resumesAt, ok: true, path, text, whole: resumesAt === null };
  }
  if (ok === false && typeof why === "string") {
    return { ok: false, why };
  }
  return { ok: false, why: "the briefing route answered something that is not a read" };
}

/**
 * A wire `nextFrom` as a read's: `null` for a whole read, a positive whole number for a part, `undefined` for anything
 * else, which is a failed read.
 *
 * @returns the offset, `null`, or `undefined` when it is neither
 */
function restOffsetOf({ nextFrom }: { nextFrom: unknown }): number | null | undefined {
  if (nextFrom === null) {
    return null;
  }
  if (typeof nextFrom === "number" && Number.isSafeInteger(nextFrom) && nextFrom > 0) {
    return nextFrom;
  }
  return undefined;
}

/** UTF-8 bytes of a value as JSON — what the cap counts. */
function bytesOf({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The longest prefix of a text, whole code points, whose JSON string costs at most `maxBytes` — escapes included.
 *
 * @returns the prefix
 */
function prefixWithin({ text, maxBytes }: { text: string; maxBytes: number }): string {
  const points = Array.from(text);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bytesOf({ value: points.slice(0, mid).join("") }) - 2 <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return points.slice(0, low).join("");
}

/**
 * A read briefing as the voice is handed it, its source stripped.
 *
 * @returns the briefing
 */
function forVoice({ briefing }: { briefing: ReadCardBriefing }): CardBriefing {
  if (briefing.read === false) {
    return briefing;
  }
  if (briefing.read === "partial") {
    const { read, rest, say, slug, text } = briefing;
    return { read, rest, say, slug, text };
  }
  return { read: true, slug: briefing.slug, text: briefing.text };
}

/**
 * Every briefing with its text cut to a byte share, a cut one marked partial with where its rest starts: the cut
 * prefix's UTF-8 bytes, which are an offset into the verb's words only when no mask changed their length — else the
 * top of the page, so a reread repeats what was carried and never skips past what was not.
 *
 * @returns the briefings, in order
 */
function cutTo({
  briefings,
  shareBytes,
}: {
  briefings: readonly ReadCardBriefing[];
  shareBytes: number;
}): readonly CardBriefing[] {
  return briefings.map((briefing): CardBriefing => {
    if (briefing.read === false) {
      return briefing;
    }
    const text = prefixWithin({ maxBytes: shareBytes, text: briefing.text });
    if (text === briefing.text) {
      return forVoice({ briefing });
    }
    const { slug, source } = briefing;
    const from = source.masked ? 0 : new TextEncoder().encode(text).length;
    return { read: "partial", rest: { from, path: source.path }, say: firstPartOnlySay({ slug }), slug, text };
  });
}

/** The briefings a card links past what one answer can name, counted and said rather than silently dropped. */
export interface BriefingsLeftOut {
  /** How many of the card's briefings, from the end of its list, the answer does not carry. */
  readonly count: number;
  /** The sentence the voice says for them, word for word. */
  readonly say: string;
}

/** A card's answer with its briefings attached, and the count of any it could not carry. */
export type WithBriefings<Answer> = Answer & {
  readonly briefings: readonly CardBriefing[];
  readonly briefingsLeftOut?: BriefingsLeftOut;
};

/**
 * The sentence the voice says for the briefings a card links past what one answer can carry.
 *
 * @param count how many were left out, at least one
 * @returns the sentence
 */
export function leftOutSay({ count }: { count: number }): string {
  if (count === 1) {
    return "This card links one more briefing I couldn't fit in, so I can't read that to you.";
  }
  return `This card links ${count} more briefings I couldn't fit in, so I can't read those to you.`;
}

/**
 * The answer carrying the card's first `kept` briefings cut to `shareBytes`, and the count of the rest.
 *
 * @returns the candidate answer
 */
function candidateOf<Answer extends Readonly<Record<string, unknown>>>({
  answer,
  briefings,
  kept,
  shareBytes,
}: {
  answer: Answer;
  briefings: readonly ReadCardBriefing[];
  kept: number;
  shareBytes: number;
}): WithBriefings<Answer> {
  const handed = cutTo({ briefings: briefings.slice(0, kept), shareBytes });
  const count = briefings.length - kept;
  if (count === 0) {
    return { ...answer, briefings: handed };
  }
  return { ...answer, briefings: handed, briefingsLeftOut: { count, say: leftOutSay({ count }) } };
}

/**
 * The largest whole number in `[low, high]` that `fits`, by binary search; `low` when none does.
 *
 * @returns the number
 */
function largestFitting({ low, high, fits }: { low: number; high: number; fits: (value: number) => boolean }): number {
  let best = low;
  let from = low;
  let to = high;
  while (from <= to) {
    const mid = Math.floor((from + to) / 2);
    if (fits(mid)) {
      best = mid;
      from = mid + 1;
    } else {
      to = mid - 1;
    }
  }
  return best;
}

/**
 * The card's answer with its briefings attached, fitted under `maxBytes`: whole when it fits, else every briefing
 * that was read cut to an equal share of what is left — the largest share that still fits — and marked partial.
 * Only when even a bare entry per briefing is over the cap (say, 200 unreadable links) does the answer carry
 * the first ones that fit and COUNT the rest in `briefingsLeftOut`, with the sentence that says so — never a
 * silent drop, and never an answer the page would refuse whole. The guarantee is against `capBytes`, the page's own
 * cap, not `maxBytes`: a card whose bare answer leaves no room under `maxBytes` is fitted again under `capBytes`, so it
 * still carries what of its briefings the page can hold. Residue, stated: a card with no room
 * under `capBytes` even for the one sentence counting its briefings is returned over it, so the page refuses it whole
 * and the model is handed that refusal naming the tool. A card within those last bytes of the cap is refused
 * rather than read with its briefing silently missing.
 *
 * @param answer the card's answer before its briefings
 * @param maxBytes the UTF-8 bytes the fit aims under, leaving the delivery's headroom
 * @param capBytes the page's own cap, which an answer over is refused whole
 * @returns the answer with `briefings`, and `briefingsLeftOut` when any had to be
 */
export function withFittedBriefings<Answer extends Readonly<Record<string, unknown>>>({
  answer,
  briefings,
  maxBytes,
  capBytes,
}: {
  answer: Answer;
  briefings: readonly ReadCardBriefing[];
  maxBytes: number;
  capBytes: number;
}): WithBriefings<Answer> {
  const whole = { ...answer, briefings: briefings.map((briefing) => forVoice({ briefing })) };
  if (bytesOf({ value: whole }) <= maxBytes) {
    return whole;
  }
  const aimed = fittedUnder({ answer, briefings, limit: maxBytes });
  if (bytesOf({ value: aimed }) <= maxBytes) {
    return aimed;
  }
  return fittedUnder({ answer, briefings, limit: capBytes });
}

/**
 * The card's answer with the most briefings, each cut to the largest equal share, that serialises under `limit` — or,
 * when none fits, every briefing counted as left out.
 *
 * @returns the candidate answer
 */
function fittedUnder<Answer extends Readonly<Record<string, unknown>>>({
  answer,
  briefings,
  limit,
}: {
  answer: Answer;
  briefings: readonly ReadCardBriefing[];
  limit: number;
}): WithBriefings<Answer> {
  const fitsAt = ({ kept, shareBytes }: { kept: number; shareBytes: number }): boolean =>
    bytesOf({ value: candidateOf({ answer, briefings, kept, shareBytes }) }) <= limit;
  // Keeping every briefing drops `briefingsLeftOut`, so the size is not monotonic across that last step: one bare
  // entry can be smaller than the sentence counting it out. Every briefing kept is tried on its own, and
  // the search runs only over counts that all carry the sentence, where each one more kept is one entry larger.
  let kept = briefings.length;
  if (!fitsAt({ kept, shareBytes: 0 })) {
    kept = largestFitting({ fits: (count) => fitsAt({ kept: count, shareBytes: 0 }), high: kept - 1, low: 0 });
  }
  const shareBytes = largestFitting({ fits: (share) => fitsAt({ kept, shareBytes: share }), high: limit, low: 0 });
  return candidateOf({ answer, briefings, kept, shareBytes });
}
