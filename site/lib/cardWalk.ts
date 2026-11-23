/**
 * The Queue walk on one call, as the page sees it — pure: which cards the voice resolved this call, and whether an
 * `open_card` just moved the walk from one of them to the next.
 *
 * A card goes off the Queue when the walk moves on to the next one, unless the owner says to come back to it. So
 * the page, not the voice, decides that the walk moved: ordinary movement needs no judgement, and a voice that forgot
 * to say so would leave the stale card up. The voice marks only the exception it alone heard — `open_card`'s
 * `come_back_to_previous` — and `talk transcript` turns the line into a removal or a deferral (`src/talk/cardMove.ts`).
 *
 * A move is the walk's only when all of these hold, so a card is never taken off by a call that never looked at it:
 *
 * - the card the owner leaves was resolved by `read_card`, `open_card` or `triage_next` on THIS call;
 * - it is the card open on the page when the next one opens — or, with NO card open there, the card the walk last put
 *   in front of the owner ({@link CardWalk.front}) as that opening BEGAN;
 * - no other opening on this call put a card in front of the owner while this one was in flight;
 * - the console actually put the next card in front of the owner (`opened`), so a switched-off or refused opening moves
 *   nothing, nor does a card that already left their Queue;
 * - the next card is a different card.
 *
 * ## The card in front of the owner outlives the page leaving it
 *
 * Once the owner is done reacting to a card it goes from the queue, and it only comes back when there is something new
 * to react to. MEASURED on one call: the voice put an ask card in front of the owner, the owner followed its linked
 * report, and every stretch they spoke for the next 35 minutes — their ruling included — carried no open card, so a
 * later `open_card` saw nothing to move on from and the card stayed up. So the walk keeps the card it last put in front
 * of the owner, and that card is the one left when the page shows none. It is never used to say what the owner's words
 * were ABOUT: speech is still stamped with the page's own open card, so words said on the linked page never land on the
 * card, and nothing here removes a card without the walk moving on to another one.
 *
 * Two openings on one call can be in flight at once — the voice starts a tool call without waiting for the last — and
 * finish in either order. So every opening that put a card in front of the owner leaves a fresh token
 * on the walk ({@link CardWalk.lastPut}), and one that finds a different token than it began with is OVERTAKEN: it moves
 * nothing — not the page's card, not the front card — and leaves NO card in front, since which one the owner is looking
 * at is no longer known and a card left up is the failure that costs them least. A token, not the front card's value: three
 * openings can cycle the front from A to B and back to A while an older one is in flight, and an equal value would
 * read as untouched; and the page's card read as it began is no safer, since another opening may have re-opened it. A
 * `Symbol` rather than a count, because no two are ever equal, so no number of openings can wrap one back.
 */
import { CARD_KEY } from "./cardKey";
import { prCardKeyParts } from "./prCardKey";
import type { CardMoveCallLine } from "./talkTranscript";

/**
 * Whether `talk transcript` writes a move naming this key: a card key, and a pull request's only with its repository,
 * as `src/talk/cardMove.ts` refuses a bare `pr:<number>`.
 */
function movableKey({ key }: { key: string }): boolean {
  return CARD_KEY.test(key) && (!key.startsWith("pr:") || prCardKeyParts({ key }) !== undefined);
}

/** The walk so far on one call: each card the voice resolved, when it first did, and the card in front of the owner. */
export interface CardWalk {
  readonly resolved: ReadonlyMap<string, string>;
  /**
   * The card the walk last put in front of the owner — an `open_card` or `triage_next` the console opened — until the walk
   * moves on; `undefined` when it has put none there. The page leaving it (its linked report, a thread) keeps it.
   */
  readonly front: string | undefined;
  /** Minted afresh each time an opening puts a card in front of the owner; an opening that sees it change was overtaken. */
  readonly lastPut: symbol;
}

/** The walk a fresh call starts with: nothing resolved, nothing in front of the owner, no opening finished. */
export const FRESH_WALK: CardWalk = { front: undefined, lastPut: Symbol("fresh walk"), resolved: new Map() };

/** What an opening read off the walk as it began: the card in front of the owner and the last opening's token. */
export type WalkBegan = Pick<CardWalk, "front" | "lastPut">;

/** What a `card-move` line carries beyond its instant and kind. */
export type CardWalkMoveFields = Omit<CardMoveCallLine, "atIso" | "kind">;

/** The most characters a move's request id may carry — `talk transcript`'s own bound. */
const REQUEST_ID_MAX = 200;

/**
 * The walk once a card was resolved: its first instant kept, so the owner's words over it are read from when the walk first
 * reached it.
 *
 * @param walk the walk so far
 * @param cardKey the card a `read_card` or `open_card` resolved, `undefined` when it resolved none or one off the owner's Queue
 * @param nowIso when it was resolved
 * @returns the walk
 */
export function walkResolved({
  walk,
  cardKey,
  nowIso,
}: {
  walk: CardWalk;
  cardKey: string | undefined;
  nowIso: string;
}): CardWalk {
  if (cardKey === undefined || walk.resolved.has(cardKey)) {
    return walk;
  }
  return { ...walk, resolved: new Map([...walk.resolved, [cardKey, nowIso]]) };
}

/**
 * One `open_card`'s or `triage_next`'s step of the walk: the move it made, if it made one, and the walk after it. The
 * card left is dropped from the walk, so a second opening on the same call starts its words afresh; the card it opened
 * is the one in front of the owner now, and a card that did not open leaves the one before in front.
 *
 * @param walk the walk as it stands when the call finished
 * @param from the card open on the page when the call ran, read before it moved anything; `undefined` when none was,
 *   and then `began.front` is the card left; neither is, once another opening overtook this one
 * @param began what the walk read as the call began, which says whether another opening overtook this one
 * @param to the card it resolved, `undefined` when it resolved none or one off the owner's Queue
 * @param opened whether the console put that card in front of the owner
 * @param comeBack the model's `come_back_to_previous`; only a literal `true` counts
 * @param requestId the `open_card` call's own token, which names the move
 * @param nowIso when it ran
 * @returns the move to write, or `undefined`, and the walk after it
 */
export function walkOpened({
  walk,
  from,
  began,
  to,
  opened,
  comeBack,
  requestId,
  nowIso,
}: {
  walk: CardWalk;
  from: string | undefined;
  began: WalkBegan;
  to: string | undefined;
  opened: boolean;
  comeBack: unknown;
  requestId: string;
  nowIso: string;
}): { readonly walk: CardWalk; readonly move: CardWalkMoveFields | undefined } {
  const resolvedAfter = walkResolved({ cardKey: to, nowIso, walk });
  // Another opening put a card in front of the owner while this one was in flight: which card is there is unknown.
  const overtaken = walk.lastPut !== began.lastPut;
  const putInFront = opened && to !== undefined;
  let front = walk.front;
  if (overtaken) {
    front = undefined;
  } else if (putInFront) {
    front = to;
  }
  let lastPut = walk.lastPut;
  if (putInFront) {
    lastPut = Symbol(requestId);
  }
  const after: CardWalk = { front, lastPut, resolved: resolvedAfter.resolved };
  // The page's open card when it has one; the card the walk had put in front of the owner as this opening began when the
  // page shows none; and no card at all once another opening overtook this one.
  let left: string | undefined;
  if (overtaken) {
    left = undefined;
  } else if (from !== undefined) {
    left = from;
  } else {
    left = began.front;
  }
  if (left === undefined || to === undefined || !opened || left === to) {
    return { move: undefined, walk: after };
  }
  const fromSinceIso = walk.resolved.get(left);
  // A line `talk transcript` would refuse would cost the whole batch it rides in, the owner's words included.
  const writable =
    movableKey({ key: left }) && movableKey({ key: to }) && requestId.length > 0 && requestId.length <= REQUEST_ID_MAX;
  if (fromSinceIso === undefined || !writable) {
    return { move: undefined, walk: after };
  }
  const resolved = new Map(after.resolved);
  resolved.delete(left);
  const move: CardWalkMoveFields = {
    disposition: comeBack === true ? "come-back" : "moved-on",
    fromCardKey: left,
    fromSinceIso,
    requestId,
    toCardKey: to,
  };
  return { move, walk: { front, lastPut, resolved } };
}
