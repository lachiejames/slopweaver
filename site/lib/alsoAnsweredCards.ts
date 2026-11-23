/**
 * The OTHER Queue cards one relay says the owner's words also answer (`relay_steer`'s `also_answers`), checked before a
 * key of them can reach `talk relay --also-answers`. Pure.
 *
 * Queue cards must refresh. A card answered aloud on an earlier call with a DIFFERENT card open would stay stale
 * (measured: four such cards),
 * since only the open card lands. Naming the others lets the verb land them too — and a key the voice names is the
 * voice's reading, which the context pack can steer. So the page holds every key to two facts the voice cannot write:
 * the latest `action_items` answer served the owner this call listed it, and the Queue still holds it now. One key
 * failing any check refuses the whole call: a relay that cleared four of five cards it was told to would be the
 * voice's partial reading landed as the owner's word.
 *
 * {@link alsoAnswersShapeOf} is the structural half alone, which the route re-checks on a posted body.
 */
import { CARD_KEY } from "./cardKey";
import { prCardKeyParts } from "./prCardKey";
import { unreadClause } from "./unreadFit";

/** The most other cards one relay may name — `ALSO_ANSWERS_MAX` in `src/talk/cardKey.ts`, held equal by a test. */
export const ALSO_ANSWERS_MAX = 5;

/**
 * Kinds words never answer as an also-answered card — `NEVER_ALSO_ANSWERED` in `src/talk/cardKey.ts`: a hand step, a
 * check-in, and the three kinds no register holds.
 */
export const NEVER_ALSO_ANSWERED: readonly string[] = ["hand:", "act:", "recipe:", "align:", "candidate:"];

/** What one `also_answers` value came to: the keys to land, in the order named, or why the call is refused. */
export type AlsoAnswersRead =
  { readonly kind: "accepted"; readonly keys: readonly string[] } | { readonly kind: "refused"; readonly why: string };

/**
 * The structural checks alone: absent is none, else a list of at most {@link ALSO_ANSWERS_MAX} distinct card keys,
 * none of a kind words never answer and none the card the relay is already about.
 *
 * @param value the posted or argued `also_answers`, as it arrived
 * @param about the card the relay is already about, or empty
 * @returns the keys in the order named, or why the value is refused
 */
export function alsoAnswersShapeOf({ value, about }: { value: unknown; about: string }): AlsoAnswersRead {
  if (value === undefined) {
    return { keys: [], kind: "accepted" };
  }
  if (!Array.isArray(value)) {
    return { kind: "refused", why: "also_answers must be a list of card keys" };
  }
  if (value.length > ALSO_ANSWERS_MAX) {
    return {
      kind: "refused",
      why: `also_answers names ${String(value.length)} cards; one relay names at most ${String(ALSO_ANSWERS_MAX)}`,
    };
  }
  const keys: string[] = [];
  for (const key of value) {
    if (typeof key !== "string" || !CARD_KEY.test(key)) {
      return { kind: "refused", why: "each also_answers entry must be a card key such as ask:<slug>" };
    }
    if (key.startsWith("pr:") && prCardKeyParts({ key }) === undefined) {
      return { kind: "refused", why: `${key} names no repository; a pull request's key is pr:<owner>.<repo>.<n>` };
    }
    if (NEVER_ALSO_ANSWERED.some((kind) => key.startsWith(kind))) {
      return { kind: "refused", why: `${key} is a kind the owner's words never answer as another card` };
    }
    if (key === about) {
      return {
        kind: "refused",
        why: `${key} is the open card: answers_open_card says whether the owner's words answer it`,
      };
    }
    if (keys.includes(key)) {
      return { kind: "refused", why: `${key} is named twice in also_answers` };
    }
    keys.push(key);
  }
  return { keys, kind: "accepted" };
}

/**
 * The page's whole check: the structural one, then every key both served to the owner in the latest `action_items`
 * answer this call and still on the owner's Queue now.
 *
 * @param value the tool call's `also_answers`, as it arrived
 * @param about the card the relay is already about, or empty
 * @param servedKeys the keys the latest `action_items` answer this call listed, empty before one was served
 * @param currentKeys the keys the Queue holds now
 * @param unread the record sources the read behind `currentKeys` could not read: a card missing from it may only be
 *   unread, so the refusal names them rather than calling it gone, held to `fitUnread`'s budget so a long reason
 *   never carries the refusal past the tool output cap
 * @returns the keys to land, in the order named, or why the whole call is refused
 */
export function alsoAnswersOf({
  value,
  about,
  servedKeys,
  currentKeys,
  unread,
}: {
  value: unknown;
  about: string;
  servedKeys: ReadonlySet<string>;
  currentKeys: ReadonlySet<string>;
  unread: readonly { readonly source: string; readonly why: string }[];
}): AlsoAnswersRead {
  const shape = alsoAnswersShapeOf({ about, value });
  if (shape.kind === "refused") {
    return shape;
  }
  for (const key of shape.keys) {
    if (!servedKeys.has(key)) {
      return {
        kind: "refused",
        why: `${key} was neither in the action_items you last read the owner this call nor the card you put in front of them`,
      };
    }
    if (!currentKeys.has(key) && unread.length > 0) {
      return { kind: "refused", why: `${key} is not among what has loaded; still unread: ${unreadClause({ unread })}` };
    }
    if (!currentKeys.has(key)) {
      return { kind: "refused", why: `${key} is no longer on the owner's Queue` };
    }
  }
  return shape;
}

/**
 * The served keys this call may name: the held snapshot only when the call that served it is the call the page is on
 * now. A reconnect or rollover mints a new call without the owner's press of fresh, so the bound is the
 * call id, and no call at all serves nothing.
 *
 * @param held the snapshot the latest `action_items` answer wrote, with the call it was served on
 * @param now the call the page is on now, absent between calls
 * @returns the snapshot's keys when it was served on this call, else none
 */
export function servedThisCall({
  held,
  now,
}: {
  held: { readonly call: string | undefined; readonly keys: ReadonlySet<string> };
  now: string | undefined;
}): ReadonlySet<string> {
  if (now === undefined || held.call !== now) {
    return new Set();
  }
  return held.keys;
}
