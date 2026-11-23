/**
 * The share state's clock: its colours, the business days behind them, and the two horizons its absences are read
 * through, in words. Why each colour is what it is, and what each horizon rests on, is `./channelShare.ts`'s header.
 *
 * Pure. The clock is `nowIso`.
 */
import { BUSINESS_DAY_MS, businessMsBetween } from "./businessTime.js";

/** Business days with no reviewer after which the state reads red and the page suggests naming one. */
export const RED_AFTER_BUSINESS_DAYS = 3;

/** The three colours of the clock, as the owner reads them, and `unknown` where the window cannot carry the absence. */
export type ChannelShareTone = "green" | "yellow" | "red" | "unknown";

/**
 * Business milliseconds as days, to one decimal place.
 *
 * @returns the days
 */
function daysOf({ ms }: { ms: number }): number {
  return Math.round((ms / BUSINESS_DAY_MS) * 10) / 10;
}

/**
 * A day count as words: `1 business day`, `0.4 business days`.
 *
 * @returns the phrase
 */
function daysWords({ days }: { days: number }): string {
  if (days === 1) {
    return "1 business day";
  }
  return `${String(days)} business days`;
}

/**
 * A minute as the rows print one: the date, a space, then `HH:MMZ`.
 *
 * @returns the minute
 */
export function minuteOf({ iso }: { iso: string }): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** How far one absence is carried: the instant it holds through, or the words for why it is not carried at all. */
export type Carried = { readonly throughIso: string } | { readonly throughIso: undefined; readonly missing: string };

/** The two absences, each as far as its own carrier holds it — never merged, so the line can say which is short. */
export interface Horizons {
  /** No ask: the corpus watermark. */
  readonly asks: Carried;
  /** No reply: the earliest of the whole-thread reads. */
  readonly replies: Carried;
}

/**
 * Two instants as one phrase, merged when they name the same minute: `asks and replies are read through M`, else
 * `asks are read through A and replies through R`, or just the one given.
 *
 * @param asksIso where asks are read to, when that belongs in the phrase
 * @param repliesIso where replies are read to, when that belongs in the phrase
 * @param lead the words between the noun and the instant, as a plural verb: `are read only through`
 * @returns the phrase, empty when neither is given
 */
function throughWords({
  asksIso,
  repliesIso,
  lead,
}: {
  asksIso: string | undefined;
  repliesIso: string | undefined;
  lead: string;
}): string {
  if (asksIso === undefined && repliesIso === undefined) {
    return "";
  }
  if (repliesIso === undefined) {
    return `asks ${lead} ${minuteOf({ iso: asksIso! })}`;
  }
  if (asksIso === undefined) {
    return `replies ${lead} ${minuteOf({ iso: repliesIso })}`;
  }
  if (minuteOf({ iso: asksIso }) === minuteOf({ iso: repliesIso })) {
    return `asks and replies ${lead} ${minuteOf({ iso: asksIso })}`;
  }
  const through = lead.slice(lead.lastIndexOf(" ") + 1);
  return `asks ${lead} ${minuteOf({ iso: asksIso })} and replies ${through} ${minuteOf({ iso: repliesIso })}`;
}

/**
 * One horizon in words: where its carrier stops, or why it carries nothing.
 *
 * @param noun what the carrier would have seen: `asks`, `replies`
 * @param by the carrier's own name, for a reader who wants to go and look
 * @returns `asks seen through M (the Slack corpus)`, or `asks unproven — <why>`
 */
function seenPart({ carried, noun, by }: { carried: Carried; noun: string; by: string }): string {
  if (carried.throughIso === undefined) {
    return `${noun} unproven — ${carried.missing}`;
  }
  return `${noun} seen through ${minuteOf({ iso: carried.throughIso })} (${by})`;
}

/**
 * What each absence is read through, for a reader asking why the clock says what it says.
 *
 * @returns both horizons in words, asks first
 */
export function seenOf({ horizons }: { horizons: Horizons }): string {
  const asks = seenPart({ by: "the Slack corpus", carried: horizons.asks, noun: "asks" });
  const replies = seenPart({ by: "the whole thread", carried: horizons.replies, noun: "replies" });
  return `${asks}, ${replies}`;
}

/** Where the clock stands: its colour, badge and line, how far into it the post is, and the instant it was read at. */
interface Clock {
  readonly tone: ChannelShareTone;
  readonly badge: string;
  readonly why: string;
  readonly sincePost: number;
  readonly asOfIso: string;
}

/**
 * The clock when an absence is not carried far enough: green is true whether or not anything was missed, so it
 * stands through the first business day, and nothing else does.
 *
 * @param sinceNowMs business milliseconds from the post to now
 * @param short the words for each carrier that falls short, and what it could be hiding: `an ask`, `a reply`
 * @returns green inside the first business day, else unknown
 */
function unprovenClock({
  asOfIso,
  sinceNowMs,
  short,
}: {
  asOfIso: string;
  sinceNowMs: number;
  short: { readonly words: string; readonly hidden: string };
}): Clock {
  const sincePost = daysOf({ ms: sinceNowMs });
  const days = daysWords({ days: sincePost });
  if (sinceNowMs < BUSINESS_DAY_MS) {
    const why = `${days} into the first business day; ${short.words}, so ${short.hidden} may not be seen yet`;
    return { asOfIso, badge: "waiting for engagement", sincePost, tone: "green", why };
  }
  const why = `${days} since the post, and ${short.words}, so ${short.hidden} since may not be seen — sync Slack`;
  return { asOfIso, badge: "clock not known", sincePost, tone: "unknown", why };
}

/**
 * The clock read AS OF the earlier horizon, both absences carried to within a business day of now.
 *
 * @param repliesAtIso where the thread reads stop, capped at now — a reply's quiet is measured to there
 * @param suffix the words naming whichever horizon stops short of now, else empty
 * @returns the colour — or `undefined` when an instant cannot be read
 */
function provenClock({
  postedAtIso,
  lastReplyAtIso,
  asOfIso,
  repliesAtIso,
  suffix,
}: {
  postedAtIso: string;
  lastReplyAtIso: string | undefined;
  asOfIso: string;
  repliesAtIso: string;
  suffix: string;
}): Clock | undefined {
  const sincePostMs = businessMsBetween({ fromIso: postedAtIso, toIso: asOfIso });
  if (sincePostMs === undefined) {
    return undefined;
  }
  const sincePost = daysOf({ ms: sincePostMs });
  const at = { asOfIso, sincePost };
  const days = daysWords({ days: sincePost });
  if (sincePostMs >= RED_AFTER_BUSINESS_DAYS * BUSINESS_DAY_MS) {
    const why = `${days} since the post and nobody reviewing${suffix} — name a reviewer`;
    return { ...at, badge: "no reviewer — name one", tone: "red", why };
  }
  if (lastReplyAtIso === undefined && sincePostMs >= BUSINESS_DAY_MS) {
    return { ...at, badge: "no engagement", tone: "yellow", why: `no reply in ${days} since the post${suffix}` };
  }
  if (lastReplyAtIso === undefined) {
    const why = `no reply yet, ${days} into the first business day${suffix}`;
    return { ...at, badge: "waiting for engagement", tone: "green", why };
  }
  // A reply's quiet is an absence of replies, so the thread reads carry it — not the corpus, which may stop earlier.
  const sinceReplyMs = businessMsBetween({ fromIso: lastReplyAtIso, toIso: repliesAtIso });
  if (sinceReplyMs === undefined) {
    return undefined;
  }
  const sinceReply = daysWords({ days: daysOf({ ms: sinceReplyMs }) });
  if (sinceReplyMs >= BUSINESS_DAY_MS) {
    const why = `the thread went quiet ${sinceReply} ago and nobody is reviewing${suffix}`;
    return { ...at, badge: "conversation stalled", tone: "yellow", why };
  }
  return { ...at, badge: "in conversation", tone: "green", why: `the newest reply was ${sinceReply} ago${suffix}` };
}

/**
 * The earlier of two ISO instants, compared as instants.
 *
 * @returns whichever is earlier
 */
function earlierOf({ a, b }: { a: string; b: string }): string {
  if (Date.parse(a) <= Date.parse(b)) {
    return a;
  }
  return b;
}

/**
 * Where the clock stands, read at the last instant the Slack evidence can vouch for.
 *
 * Every colour but "in conversation" rests on an absence — no ask, no reply — each carried only as far as its own
 * horizon ({@link Horizons}). So the clock is read AS OF the earlier of them (or now, when both have caught up) and
 * the line names whichever stops short. A horizon more than a business day behind now could be hiding a colour
 * change, and one that does not reach past the post carries nothing after it; both are {@link unprovenClock}, which
 * names the carrier that fell short and what it could be hiding — an ask, a reply, or both.
 *
 * @returns the clock — or `undefined` when an instant cannot be read
 */
export function clockOf({
  postedAtIso,
  lastReplyAtIso,
  horizons,
  nowIso,
}: {
  postedAtIso: string;
  lastReplyAtIso: string | undefined;
  horizons: Horizons;
  nowIso: string;
}): Clock | undefined {
  const sinceNowMs = businessMsBetween({ fromIso: postedAtIso, toIso: nowIso });
  if (sinceNowMs === undefined) {
    return undefined;
  }
  const missing: string[] = [];
  const hidden: string[] = [];
  const lagging: { asks: string | undefined; replies: string | undefined } = { asks: undefined, replies: undefined };
  const reached: { asks: string; replies: string } = { asks: postedAtIso, replies: postedAtIso };
  for (const [key, noun] of [
    ["asks", "an ask"],
    ["replies", "a reply"],
  ] as const) {
    const carried = horizons[key];
    if (carried.throughIso === undefined) {
      missing.push(carried.missing);
      hidden.push(noun);
      continue;
    }
    const atIso = earlierOf({ a: carried.throughIso, b: nowIso });
    const lagMs = businessMsBetween({ fromIso: atIso, toIso: nowIso });
    if (lagMs === undefined) {
      return undefined;
    }
    reached[key] = atIso;
    if (Date.parse(atIso) <= Date.parse(postedAtIso) || lagMs >= BUSINESS_DAY_MS) {
      lagging[key] = atIso;
      hidden.push(noun);
    }
  }
  const lagWords = throughWords({ asksIso: lagging.asks, repliesIso: lagging.replies, lead: "are read only through" });
  const words = [...missing, lagWords].filter((one) => one !== "").join(" and ");
  const asOfIso = earlierOf({ a: reached.asks, b: reached.replies });
  if (hidden.length > 0) {
    return unprovenClock({ asOfIso, short: { hidden: hidden.join(" or "), words }, sinceNowMs });
  }
  let suffix = "";
  const shortOfNow = ({ iso }: { iso: string }): string | undefined =>
    Date.parse(iso) < Date.parse(nowIso) ? iso : undefined;
  const stopWords = throughWords({
    asksIso: shortOfNow({ iso: reached.asks }),
    lead: "seen through",
    repliesIso: shortOfNow({ iso: reached.replies }),
  });
  if (stopWords !== "") {
    suffix = `, ${stopWords}`;
  }
  return provenClock({ asOfIso, lastReplyAtIso, postedAtIso, repliesAtIso: reached.replies, suffix });
}
