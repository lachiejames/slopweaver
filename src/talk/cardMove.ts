/**
 * Moving on from a Queue card takes it off the owner's Queue, unless the owner said to come back to it — the call line
 * the page writes when the walk moves, and the pure fold that turns those lines into moves. No filesystem, no clock.
 *
 * A card is always removed when the walk moves on to the next one, unless the owner says to come back to it. Without
 * that, a card the owner reacted to stayed on their Queue when the voice opened the next one, because only words the
 * voice judged an ANSWER land (`./cardUtterance.ts`), and the walk's own movement recorded nothing.
 *
 * ## The page decides that the card changed; the voice decides only "come back"
 *
 * The page writes a `card-move` line when `open_card` presents card B while card A — one `read_card` or `open_card`
 * resolved this call — is still the card open on the page (`site/lib/cardWalk.ts`). Ordinary movement needs no
 * judgement, so omission can never keep a stale card up. The voice marks the one exception it alone heard: the owner's words
 * said to return to A (`open_card`'s `come_back_to_previous`), which defers A rather than removing it.
 *
 * ## A move is not an answer
 *
 * Nothing here runs `cardAnswerVerdict`: the owner may have said nothing over A, or only filler, and the card still
 * leaves. What they did say over A rides along, exactly as the call file holds it, and nothing is ever written in their
 * name when they were silent. A move writes no ruling and registers no work (`../cli/commands/talk/cardMoveApply.ts`).
 */
import { callTouchedByTestInstance } from "./callOrigin.js";
import { type CallEntry, type CallSegment, foldCall } from "./callRecord.js";
import { CARD_KEY } from "./cardKey.js";
import type { CardMoveDisposition } from "./cardMoveLine.js";
import { prCardKeyParts } from "./prCardKey.js";

/** The most characters of the owner's words over the card a move keeps; the call file keeps the rest. */
export const MOVE_WORDS_MAX = 2000;

/** One move of the walk, as the ledger and the deferral record it. */
export interface CardWalkMove {
  /** `call:<callId>#move:<requestId>` — where the move happened. */
  readonly anchor: string;
  readonly fromCardKey: string;
  readonly toCardKey: string;
  /** When the walk moved. */
  readonly decidedIso: string;
  readonly disposition: CardMoveDisposition;
  /** The owner's words over the card they left, as the call file holds them; absent when they said nothing over it. */
  readonly words?: string;
}

/** The registers a move takes off the owner's Queue. A hand step, an import and a check-in each settle another way. */
const MOVED_OFF_KINDS: ReadonlySet<string> = new Set(["ask", "draft", "post", "review", "pr"]);

/**
 * Whether moving on from a card takes it off the owner's Queue. A hand step settles when it is done, a staged import when the
 * store resolves it, and a check-in only on its structured ruling, so none of them leaves on movement.
 *
 * @param cardKey the card the walk left
 * @returns whether the move removes it
 */
export function removedByMove({ cardKey }: { cardKey: string }): boolean {
  if (!CARD_KEY.test(cardKey)) {
    return false;
  }
  // A bare `pr:<n>` names no pull request card, so moving on from it takes nothing off the owner's Queue.
  if (cardKey.startsWith("pr:") && prCardKeyParts({ key: cardKey }) === undefined) {
    return false;
  }
  return MOVED_OFF_KINDS.has(cardKey.slice(0, cardKey.indexOf(":")));
}

/**
 * Where a move happened: the call and the tool call that moved the walk.
 *
 * @param callId the voice call the walk moved on
 * @param requestId the `open_card` call's token
 * @returns the anchor
 */
export function cardMoveAnchor({ callId, requestId }: { callId: string; requestId: string }): string {
  return `call:${callId}#move:${requestId}`;
}

/** A `card-move` line, parsed. */
type CardMoveEntry = Extract<CallEntry, { kind: "card-move" }>;

/**
 * The owner's words over one card between two instants, in the order they said them: every stretch of theirs that began
 * with that card open inside the window, each as the call last recorded it, whitespace collapsed and joined.
 *
 * @param segments the call's segments, in the order they began
 * @param cardKey the card the owner had open
 * @param fromIso the start of the window, inclusive
 * @param toIso the end of the window, inclusive
 * @returns the words, cut at {@link MOVE_WORDS_MAX}, or `undefined` when the owner said nothing over it
 */
function wordsOver({
  segments,
  cardKey,
  fromIso,
  toIso,
}: {
  segments: readonly CallSegment[];
  cardKey: string;
  fromIso: string;
  toIso: string;
}): string | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const said = segments
    .filter((segment) => {
      const began = Date.parse(segment.beganIso);
      return segment.who === "owner" && segment.open === cardKey && began >= from && began <= to;
    })
    .map((segment) => segment.text.replace(/\s+/gu, " ").trim())
    .filter((text) => text !== "")
    .join(" ");
  if (said === "") {
    return undefined;
  }
  return said.slice(0, MOVE_WORDS_MAX);
}

/**
 * Every move one call's walk made, in the order the page wrote them, each once: the first line of a request wins, so a
 * batch posted again never makes a second move. The owner's words over the card they left are read from the call's own
 * segments every time, so a late batch carrying more of them grows the move rather than being lost.
 *
 * @param callId the voice call whose file the lines came from, which names each move's anchor
 * @param entries the call's lines, in file order
 * @returns the moves
 */
export function cardWalkMoves({
  callId,
  entries,
}: {
  callId: string;
  entries: readonly CallEntry[];
}): readonly CardWalkMove[] {
  // The desktop test instance's walk is not the owner's: it moves nothing on their Queue (`./callOrigin.ts`).
  if (callTouchedByTestInstance({ entries })) {
    return [];
  }
  const markers = new Map<string, CardMoveEntry>();
  for (const entry of entries) {
    if (entry.kind === "card-move" && !markers.has(entry.requestId)) {
      markers.set(entry.requestId, entry);
    }
  }
  if (markers.size === 0) {
    return [];
  }
  const segments = foldCall({ callId, entries, skipped: 0 })?.segments;
  if (segments === undefined) {
    return [];
  }
  return [...markers.values()].map((marker) => {
    const move: CardWalkMove = {
      anchor: cardMoveAnchor({ callId, requestId: marker.requestId }),
      decidedIso: marker.atIso,
      disposition: marker.disposition,
      fromCardKey: marker.fromCardKey,
      toCardKey: marker.toCardKey,
    };
    const words = wordsOver({
      cardKey: marker.fromCardKey,
      fromIso: marker.fromSinceIso,
      segments,
      toIso: marker.atIso,
    });
    return words === undefined ? move : { ...move, words };
  });
}
