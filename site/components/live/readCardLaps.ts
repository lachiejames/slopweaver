/**
 * The reader for `talk laps --json` — how many looks each Queue card took the owner, and the owner's words in each
 * (`src/talk/cardLaps.ts`).
 *
 * Strict, like `./readSteeredCards.ts`: a card that does not read refuses the whole reading rather than being skipped.
 * A skipped card would draw as "first look" over a card the owner may have steered three times, which is the one claim this
 * measure exists to make honestly.
 */

import { type Bag, bags, every, isBag, num, str, strings } from "../../lib/bag";

/** One quoted word of the owner's. */
export interface ServerLapWord {
  readonly anchor: string;
  readonly atIso: string;
  readonly text: string;
}

/** One look that did not close the card, and whose lap it was. */
export interface ServerLap {
  readonly cause: "fleet" | "world";
  readonly startIso: string;
  readonly words: readonly ServerLapWord[];
}

/** One card's reading. */
export interface ServerCardLaps {
  readonly key: string;
  /** Every key the card has carried, a re-cut's predecessors first. */
  readonly keys: readonly string[];
  readonly laps: number;
  readonly fleetLaps: number;
  readonly worldLaps: number;
  readonly lastIso: string;
  readonly steers: readonly ServerLap[];
  readonly last: readonly ServerLapWord[];
  readonly steeringChars: number;
  readonly lastLookChars: number;
}

/** The whole reading. */
export interface CardLapsReading {
  /** The oldest word read: a card's looks before it are not counted, so its laps are a floor. */
  readonly sinceIso: string;
  readonly cards: readonly ServerCardLaps[];
  /** How many of the owner's words named no card and so sit on none. */
  readonly unplaced: number;
  /** Each source that did not read whole, so a count may be short. */
  readonly gaps: readonly string[];
}

/** The keys the verb's reading carries (`src/talk/cardLapsRead.ts`), and no other. */
const READING_KEYS: readonly string[] = ["cards", "gaps", "observedAtIso", "ok", "sinceIso", "unplaced"];

/** The keys each card carries (`src/talk/cardLaps.ts` `CardLaps`), and no other. */
const CARD_KEYS: readonly string[] = [
  "firstIso",
  "fleetLaps",
  "key",
  "keys",
  "laps",
  "last",
  "lastIso",
  "lastLookChars",
  "looks",
  "steeringChars",
  "steers",
  "worldLaps",
];

/** The keys each lap carries, and no other. */
const LAP_KEYS: readonly string[] = ["awayMs", "cause", "startIso", "words"];

/** The keys each quoted word carries, and no other. */
const WORD_KEYS: readonly string[] = ["anchor", "atIso", "chars", "source", "text"];

/** The places the verb says the owner's words came from. */
const UNPLACED_KEYS: readonly string[] = ["call", "chair", "relay", "typed"];

/** Whether an object carries no key outside the ones allowed. */
function onlyKeys({ bag, allowed }: { bag: Bag; allowed: readonly string[] }): boolean {
  return Object.keys(bag).every((key) => allowed.includes(key));
}

/** Whether a string is an instant `Date.parse` reads. */
function parses({ iso }: { iso: string }): boolean {
  return !Number.isNaN(Date.parse(iso));
}

/** Whether a number is a count. */
function isCount(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0;
}

/** One quoted word, or `undefined` when it does not read. */
function wordOf({ bag }: { bag: Bag }): ServerLapWord | undefined {
  const anchor = str({ bag, key: "anchor" });
  const atIso = str({ bag, key: "atIso" });
  const text = str({ bag, key: "text" });
  if (anchor === undefined || atIso === undefined || text === undefined || !onlyKeys({ allowed: WORD_KEYS, bag })) {
    return undefined;
  }
  return { anchor, atIso, text };
}

/** One lap, or `undefined` when it does not read. */
function lapOf({ bag }: { bag: Bag }): ServerLap | undefined {
  const cause = str({ bag, key: "cause" });
  const startIso = str({ bag, key: "startIso" });
  const words = every({ list: bags({ bag, key: "words" }), read: (one) => wordOf({ bag: one }) });
  if (
    (cause !== "fleet" && cause !== "world") ||
    startIso === undefined ||
    words === undefined ||
    words.length === 0 ||
    !onlyKeys({ allowed: LAP_KEYS, bag })
  ) {
    return undefined;
  }
  return { cause, startIso, words };
}

/** One card, or `undefined` when it does not read or its counts disagree with its laps. */
function cardOf({ bag }: { bag: Bag }): ServerCardLaps | undefined {
  const key = str({ bag, key: "key" });
  const keys = strings({ bag, key: "keys" });
  const lastIso = str({ bag, key: "lastIso" });
  const laps = num({ bag, key: "laps" });
  const fleetLaps = num({ bag, key: "fleetLaps" });
  const worldLaps = num({ bag, key: "worldLaps" });
  const steeringChars = num({ bag, key: "steeringChars" });
  const lastLookChars = num({ bag, key: "lastLookChars" });
  const steers = every({ list: bags({ bag, key: "steers" }), read: (one) => lapOf({ bag: one }) });
  const last = every({ list: bags({ bag, key: "last" }), read: (one) => wordOf({ bag: one }) });
  if (
    key === undefined ||
    keys === undefined ||
    lastIso === undefined ||
    !parses({ iso: lastIso }) ||
    !isCount(laps) ||
    !isCount(fleetLaps) ||
    !isCount(worldLaps) ||
    !isCount(steeringChars) ||
    !isCount(lastLookChars) ||
    steers === undefined ||
    last === undefined ||
    !onlyKeys({ allowed: CARD_KEYS, bag })
  ) {
    return undefined;
  }
  // The counts are the laps' own, so a reading where they disagree is not one the verb wrote: a line saying two fleet
  // laps over a fold heading one of them the world's would be two claims about one card. Every card has a latest look,
  // and its own key is the newest of the keys it carried.
  const fleetSteers = steers.filter((lap) => lap.cause === "fleet").length;
  if (
    steers.length !== laps ||
    fleetSteers !== fleetLaps ||
    laps - fleetSteers !== worldLaps ||
    last.length === 0 ||
    keys.at(-1) !== key
  ) {
    return undefined;
  }
  return { fleetLaps, key, keys, last, lastIso, lastLookChars, laps, steeringChars, steers, worldLaps };
}

/**
 * Project `talk laps --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the reading, or `undefined` when the payload or any card in it does not read
 */
export function readCardLaps(payload: unknown): CardLapsReading | undefined {
  if (!isBag(payload) || payload["ok"] !== true || !onlyKeys({ allowed: READING_KEYS, bag: payload })) {
    return undefined;
  }
  const sinceIso = str({ bag: payload, key: "sinceIso" });
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const cards = every({ list: bags({ bag: payload, key: "cards" }), read: (one) => cardOf({ bag: one }) });
  const gaps = every({ list: bags({ bag: payload, key: "gaps" }), read: (gap) => str({ bag: gap, key: "why" }) });
  const unplacedBag = payload["unplaced"];
  if (
    sinceIso === undefined ||
    !parses({ iso: sinceIso }) ||
    observedAtIso === undefined ||
    !parses({ iso: observedAtIso }) ||
    cards === undefined ||
    gaps === undefined ||
    !isBag(unplacedBag) ||
    !onlyKeys({ allowed: UNPLACED_KEYS, bag: unplacedBag })
  ) {
    return undefined;
  }
  const counts = UNPLACED_KEYS.map((key) => num({ bag: unplacedBag, key }));
  if (!counts.every((value) => isCount(value))) {
    return undefined;
  }
  const unplaced = counts.reduce<number>((sum, value) => sum + value, 0);
  return { cards, gaps, sinceIso, unplaced };
}
