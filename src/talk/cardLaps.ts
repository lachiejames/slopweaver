/**
 * How many laps a Queue card took to reach the owner — pure: the owner's words in, one reading per card out.
 *
 * The definition of done is opening a card and having no notes to give, on the first try; if not, how many tries,
 * how many steers, and what the steers were between the owner's first reaction and the version that went out. A lap
 * the fleet caused and a lap the world caused are counted apart. The owner has spent more time saying what is wrong
 * with Queue cards than approving them, and that ratio is where the system is against where the owner wants it.
 *
 * ## Which card the owner's words were about: only where a record names it
 *
 * A call stretch records the card open on the console when it began, and a console steer records the card it named.
 * Those are the only attributions this module makes. Matching a card's keywords against the owner's transcripts to
 * place the rest was built and MEASURED before it was dropped: scored against the 552 words of the owner's whose card
 * IS recorded (14 days), a two-rare-token floor with a one-token margin attributed 221 of them and put 7 on the right
 * card; floors three to six kept 213, 197, 159 and 130, with 7, 7, 5 and 3 right. A wrong match invents a steer the
 * owner never gave, so a matcher that is right one time in thirty is worse than an undercount. Repro: `slopweaver talk
 * laps --since 14d --calibrate`, which {@link calibrateMatcher} answers and which any future matcher has to pass
 * before it places a word. What no record names is counted per source in {@link unplacedOf}, so the page says how
 * much of what the owner said it could not place rather than hiding it.
 *
 * ## A look, a lap, and who caused it
 *
 * A LOOK is a run of the owner's words on one card with no gap over {@link LOOK_GAP_MS}. LAPS are looks less one: a
 * card the owner looked at once and never again took zero. The lap between two looks is the WORLD's when the owner
 * was away from that card for {@link AWAY_MS} or more — the version they came back to sat through an absence, so what
 * needed redoing may be the world rather than the card — and the FLEET's otherwise. That is a proxy and says so: no
 * record says whether the world actually moved.
 *
 * ## Steering against approving
 *
 * The owner's words in every look but the last are STEERING; the last look's are steering too while the card is still
 * on the Queue, and its CLOSE once it has left — which this module cannot see, so it reports the two counts and the
 * page, which knows what the Queue holds, decides. Measured in characters, never seconds: a call stretch carries one
 * instant, not a duration. Whether a card that has left the Queue left on the owner's yes or no is not in these
 * records either, so nothing here says "approved" — the page says "left the Queue".
 */
import { distinctiveTokens, indexSources, sharedRareTokens } from "../lib/rareTokens.js";

/** The longest silence inside one look: a recut lands from a session, never inside half an hour of the owner's steer. */
export const LOOK_GAP_MS = 30 * 60_000;

/** The absence after which a lap is the world's: longer than a night and a weekend, so only a real time away counts. */
export const AWAY_MS = 72 * 60 * 60_000;

/** How many more rare tokens a calibrated match's best card must share than the runner-up: a near-tie picks nothing. */
export const MATCH_MARGIN = 1;

/** How much of one utterance a steer carries; the anchor reads the whole again. */
export const STEER_CLIP = 280;

/** @internal Where an utterance of the owner's was recorded — named through {@link LapUtterance}. */
export type LapSource = "call" | "relay" | "typed" | "chair";

/** One thing the owner said, with the card its own record names when it names one. */
export interface LapUtterance {
  readonly anchor: string;
  readonly atIso: string;
  readonly text: string;
  readonly source: LapSource;
  /** The card the record itself names (a call stretch's open card, a steer's `about`), or `undefined`. */
  readonly card: string | undefined;
}

/** A card, in its own words — what a calibrated match scores the owner's words against. */
export interface LapCandidate {
  readonly key: string;
  readonly text: string;
  /** When the card was raised; a word at or before it is what raised it, never a look at it. */
  readonly bornIso: string | undefined;
}

/** One utterance whose record names its card. */
interface PlacedUtterance extends LapUtterance {
  readonly cardKey: string;
}

/** @internal One quoted word of the owner's inside a look — named through {@link CardLaps}. */
export interface LapWord {
  readonly anchor: string;
  readonly atIso: string;
  readonly source: LapSource;
  /** At most {@link STEER_CLIP} characters of it. */
  readonly text: string;
  /** Its whole length. */
  readonly chars: number;
}

/** @internal One lap: the look that did not close the card, and why the owner came back — named through {@link CardLaps}. */
export interface CardLap {
  readonly cause: "fleet" | "world";
  /** How long the owner was away from the card before the look after this one. */
  readonly awayMs: number;
  readonly startIso: string;
  readonly words: readonly LapWord[];
}

/** One card's reading. */
export interface CardLaps {
  /** The newest key in the card's lineage — the one the Queue shows. */
  readonly key: string;
  /** Every key the card has carried, a re-cut hand step's predecessors first. */
  readonly keys: readonly string[];
  readonly looks: number;
  readonly laps: number;
  readonly fleetLaps: number;
  readonly worldLaps: number;
  readonly firstIso: string;
  readonly lastIso: string;
  readonly steers: readonly CardLap[];
  /** The latest look's words — its close if the card has left the Queue, else what the owner said last. */
  readonly last: readonly LapWord[];
  /** The owner's characters in every look but the last. */
  readonly steeringChars: number;
  /** The owner's characters in the last look — a close only once the card has left the Queue; the page decides which. */
  readonly lastLookChars: number;
}

/** How many of the owner's words named no card, per place they said them. */
export type UnplacedWords = Readonly<Record<LapSource, number>>;

/**
 * Count the owner's words whose record names no card — what the reading could not place, by source.
 *
 * @param utterances the owner's words inside the window
 * @returns one count per source, zero where every word was placed
 */
export function unplacedOf({ utterances }: { utterances: readonly LapUtterance[] }): UnplacedWords {
  const counts: Record<LapSource, number> = { call: 0, chair: 0, relay: 0, typed: 0 };
  for (const one of utterances) {
    if (one.card === undefined) {
      counts[one.source] += 1;
    }
  }
  return counts;
}

/** The candidates' token sets, and the tokens too common on either side to mean anything. */
interface MatchIndex {
  readonly tokens: readonly ReadonlySet<string>[];
  readonly tooCommon: ReadonlySet<string>;
}

/** Index the candidates, ruling out a token common among the cards OR among the owner's own words. */
function matchIndex({
  candidates,
  utterances,
}: {
  candidates: readonly LapCandidate[];
  utterances: readonly LapUtterance[];
}): MatchIndex {
  const cards = indexSources({ sources: candidates.map((one) => ({ id: one.key, text: one.text })) });
  // Rare among the cards is not enough: "image" and "pasted" are rare in a card's words and in half of the owner's, so a token
  // counts only when it is rare on BOTH sides.
  const spoken = indexSources({
    sources: utterances.map((one) => ({ id: one.anchor, text: plainWords({ text: one.text }) })),
  });
  return { tokens: cards.tokens, tooCommon: new Set([...cards.tooCommon, ...spoken.tooCommon]) };
}

/** The best-scoring candidate born before the word, its score, and the runner-up's. */
interface MatchScore {
  readonly key: string | undefined;
  readonly best: number;
  readonly second: number;
}

/** The card a score picks at a floor: at least `floor` shared rare tokens, and {@link MATCH_MARGIN} past the runner-up. */
function matchOf({ score, floor }: { score: MatchScore; floor: number }): string | undefined {
  if (score.best < floor || score.best - score.second < MATCH_MARGIN) {
    return undefined;
  }
  return score.key;
}

/**
 * The owner's words without what Claude Code wrapped round them: an `[Image #n]` placeholder and a paste's tags carry no
 * subject, and matched on would tie every pasted turn to whichever card happens to mention an image.
 *
 * @param text the utterance as recorded
 * @returns the text with those wrappers removed
 */
export function plainWords({ text }: { text: string }): string {
  return text.replaceAll(/\[Image #\d+\]/gu, " ").replaceAll(/<\/?pasted_content\b[^>]*>/gu, " ");
}

/** How one utterance scores against every candidate born before it. */
function scoreMatch({
  utterance,
  candidates,
  index,
}: {
  utterance: LapUtterance;
  candidates: readonly LapCandidate[];
  index: MatchIndex;
}): MatchScore {
  const subject = distinctiveTokens({ text: plainWords({ text: utterance.text }) });
  const at = Date.parse(utterance.atIso);
  let best = 0;
  let second = 0;
  let key: string | undefined;
  candidates.forEach((candidate, position) => {
    const born = candidate.bornIso === undefined ? Number.NaN : Date.parse(candidate.bornIso);
    if (!Number.isNaN(born) && at <= born) {
      return;
    }
    const shared = sharedRareTokens({ source: index.tokens[position]!, subject, tooCommon: index.tooCommon });
    if (shared > best) {
      second = best;
      best = shared;
      key = candidate.key;
    } else if (shared > second) {
      second = shared;
    }
  });
  return { best, key, second };
}

/** @internal How a keyword matcher did at one floor — named through {@link calibrateMatcher}'s return. */
export interface MatchCalibrationRow {
  readonly floor: number;
  /** How many of the named words it attributed at all. */
  readonly attributed: number;
  /** How many of those it attributed to the card the record names. */
  readonly correct: number;
}

/** A keyword matcher scored against the words whose card is known. */
export interface MatchCalibration {
  /** Words a record names a card for, where that card is one the matcher could have picked. */
  readonly named: number;
  readonly rows: readonly MatchCalibrationRow[];
}

/**
 * Score a rare-token keyword matcher where the answer is known: every word whose record names a card that is also a
 * candidate is matched as though it named none, and each floor says how many it attributed and how many to the right
 * card. This is the measurement that kept matching out of the reading, and the bar a matcher must clear to enter it.
 *
 * @param utterances the owner's words
 * @param candidates the cards a word may be matched to
 * @param floors the shared-token floors to try
 * @returns the count scored and one row per floor
 */
export function calibrateMatcher({
  utterances,
  candidates,
  floors,
}: {
  utterances: readonly LapUtterance[];
  candidates: readonly LapCandidate[];
  floors: readonly number[];
}): MatchCalibration {
  const keys = new Set(candidates.map((one) => one.key));
  const index = matchIndex({ candidates, utterances });
  const scored = utterances
    .filter((one) => one.card !== undefined && keys.has(one.card) && !Number.isNaN(Date.parse(one.atIso)))
    .map((one) => ({ card: one.card, score: scoreMatch({ candidates, index, utterance: one }) }));
  const rows = floors.map((floor) => {
    const picked = scored.map((one) => ({ card: one.card, match: matchOf({ floor, score: one.score }) }));
    const attributed = picked.filter((one) => one.match !== undefined);
    return { attributed: attributed.length, correct: attributed.filter((one) => one.match === one.card).length, floor };
  });
  return { named: scored.length, rows };
}

/**
 * The newest key a card key's lineage reaches: a re-cut hand step's successor, and its successor, until none.
 *
 * @param successorOf each re-cut key's successor
 * @returns the newest key, and every key on the way, oldest first
 */
export function lineageOf({ key, successorOf }: { key: string; successorOf: ReadonlyMap<string, string> }): {
  readonly key: string;
  readonly keys: readonly string[];
} {
  const keys = [key];
  let current = key;
  let next = successorOf.get(current);
  // A cycle in the register is malformed; the walk stops at the first repeat rather than looping.
  while (next !== undefined && !keys.includes(next)) {
    keys.push(next);
    current = next;
    next = successorOf.get(current);
  }
  return { key: current, keys };
}

/** One utterance as a quoted word. */
function wordOf({ one }: { one: PlacedUtterance }): LapWord {
  return {
    anchor: one.anchor,
    atIso: one.atIso,
    chars: one.text.length,
    source: one.source,
    text: one.text.slice(0, STEER_CLIP),
  };
}

/**
 * A look's own words: a spoken relay repeats the call stretch it came from, so it is quoted only when the look holds
 * nothing else.
 */
function lookWords({ look }: { look: readonly PlacedUtterance[] }): readonly PlacedUtterance[] {
  const own = look.filter((one) => one.source !== "relay");
  if (own.length > 0) {
    return own;
  }
  return look;
}

/** The characters of a look's own words. */
function charsOf({ look }: { look: readonly PlacedUtterance[] }): number {
  return lookWords({ look }).reduce((sum, one) => sum + one.text.length, 0);
}

/**
 * Split one card's words into looks: a new look wherever the owner was silent on it for more than {@link LOOK_GAP_MS}.
 *
 * @param words the card's words, oldest first
 * @returns the looks, oldest first
 */
export function looksOf<T extends { readonly atIso: string }>({
  words,
}: {
  words: readonly T[];
}): readonly (readonly T[])[] {
  const looks: T[][] = [];
  let previous = Number.NaN;
  for (const one of words) {
    const at = Date.parse(one.atIso);
    const current = looks.at(-1);
    if (current === undefined || at - previous > LOOK_GAP_MS) {
      looks.push([one]);
    } else {
      current.push(one);
    }
    previous = at;
  }
  return looks;
}

/**
 * Every card's laps: the owner's words placed on the card their record names, grouped by card lineage, split into
 * looks, and each lap judged.
 *
 * @param utterances the owner's words inside the window, any order; one naming no card, or whose instant does not parse, is
 *   never placed
 * @param successorOf each re-cut hand step key's successor, so a re-cut is a lap on one card rather than a new card
 * @returns one reading per card the owner looked at, the most recently looked at first
 */
export function cardLapsOf({
  utterances,
  successorOf,
}: {
  utterances: readonly LapUtterance[];
  successorOf: ReadonlyMap<string, string>;
}): readonly CardLaps[] {
  const byCard = new Map<string, { keys: readonly string[]; words: PlacedUtterance[] }>();
  for (const one of utterances) {
    if (one.card === undefined || Number.isNaN(Date.parse(one.atIso))) {
      continue;
    }
    const placed: PlacedUtterance = { ...one, cardKey: one.card };
    const lineage = lineageOf({ key: one.card, successorOf });
    const entry = byCard.get(lineage.key);
    if (entry === undefined) {
      byCard.set(lineage.key, { keys: lineage.keys, words: [placed] });
      continue;
    }
    // Two steps re-cut into one leave two walks to the same newest key, so the lineage is every walk's keys, newest last.
    const predecessors = new Set([...entry.keys, ...lineage.keys]);
    predecessors.delete(lineage.key);
    entry.keys = [...predecessors, lineage.key];
    entry.words.push(placed);
  }
  const cards = [...byCard.entries()].map(([key, entry]) => {
    const words = entry.words.toSorted(
      (a, b) => Date.parse(a.atIso) - Date.parse(b.atIso) || a.anchor.localeCompare(b.anchor),
    );
    return cardOf({ key, keys: entry.keys, words });
  });
  return cards.toSorted((a, b) => Date.parse(b.lastIso) - Date.parse(a.lastIso) || a.key.localeCompare(b.key));
}

/** One card's reading from its words, oldest first. */
function cardOf({
  key,
  keys,
  words,
}: {
  key: string;
  keys: readonly string[];
  words: readonly PlacedUtterance[];
}): CardLaps {
  const looks = looksOf({ words });
  const steers: CardLap[] = looks.slice(0, -1).map((look, position) => {
    const next = looks[position + 1]!;
    const awayMs = Date.parse(next[0]!.atIso) - Date.parse(look.at(-1)!.atIso);
    let cause: CardLap["cause"] = "fleet";
    if (awayMs >= AWAY_MS) {
      cause = "world";
    }
    return {
      awayMs,
      cause,
      startIso: look[0]!.atIso,
      words: lookWords({ look }).map((one) => wordOf({ one })),
    };
  });
  const last = looks.at(-1)!;
  return {
    firstIso: words[0]!.atIso,
    fleetLaps: steers.filter((lap) => lap.cause === "fleet").length,
    key,
    keys,
    laps: steers.length,
    last: lookWords({ look: last }).map((one) => wordOf({ one })),
    lastIso: words.at(-1)!.atIso,
    lastLookChars: charsOf({ look: last }),
    looks: looks.length,
    steers,
    steeringChars: looks.slice(0, -1).reduce((sum, look) => sum + charsOf({ look }), 0),
    worldLaps: steers.filter((lap) => lap.cause === "world").length,
  };
}
