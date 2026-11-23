/**
 * The four checks a yes passes before `slack draft approve` or `slack draft record --approved` binds it to
 * a draft — pure, over what the record holding the owner's words says they were about, and what they said after them.
 *
 * A yes that answers a "needs more info" question must not send a draft, and a yes on a relay about no card at all
 * must not bind one. So:
 *
 * - **the verdict** — a relay that carried the owner's triage ruling binds a yes only when that ruling is `send-it`; a
 *   relay that predates storing one is never read as having ruled send-it, exactly as one that predates storing
 *   whether its head was cut is never read as whole;
 * - **the affirmative act** — a send-it ruling is one; a relay that carried no ruling, and a card landing, are one
 *   only when the owner's words carry a yes from a closed list and no take-back ({@link affirmativeActWhy}). An open
 *   card at the anchor alone is not a yes, so a remark said while the draft's card was open does not bind;
 * - **the card** — a relay's `about`, or the card a `call:` landing landed on, must be THIS draft's: its `post:` card
 *   or the `post:` card of a cut the register records it re-cut, or an ask or hand card whose landing kept this
 *   draft's id;
 * - **what came after** — for a relay or a card landing, no relay the owner made later on the same call, while that
 *   card or one of the next two opened was up, takes the yes back or rules otherwise without naming a card of its own
 *   ({@link draftApprovalLaterRelayError}, read by `../../../talk/approvalRelayRead.ts`). The voice opens the next
 *   card 1.1s after relaying an answer, so "oh wait, no, not that one" is relayed about the next card. A call that
 *   cannot be read whole refuses too — it cannot prove the owner did not take the yes back.
 *
 * A `talk-call:` stretch and a typed `transcript:` turn are judged by none of the four. A call is where the owner
 * agrees a message's content before any row exists (`../../../../skills/slack/reference/pre-approved.md`), so the
 * card on screen as a stretch began says nothing about which words they agreed to; a typed turn carries no card at
 * all. Both are the stated residue.
 *
 * Whether words carrying a yes on the right card MEAN yes to this draft stays judgement — "yes, but not this one"
 * carries both a yes and a take-back and refuses, yet "yes, Tobias said that" passes; these refuse what a record already
 * contradicts, and words that carry no yes at all.
 * They are facts about the evidence, so there is deliberately no escape hatch: an override would bind a yes the owner's own
 * record says they did not give. `draft pick --anchor` does not pass through here — a pick is not a yes.
 */
import type { RawWordsContext } from "../../../handover/hisWordsResolve.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import type { ApprovalLaterRelay } from "../../../talk/approvalRelayRead.js";
import { CARD_KEY } from "../../../talk/cardKey.js";
import {
  type DraftApprovalAnchorError,
  DraftApprovalAnchorErrors,
  type DraftApprovalCardMismatchError,
  type DraftApprovalLaterRelayError,
  type DraftApprovalNoAffirmativeError,
} from "./draftApprovalErrors.js";
import { affirmativeActWhy, carriesTakeBack } from "./draftApprovalWords.js";

/** The card prefix a draft's own Queue card carries. */
const POST_CARD = "post:";

/**
 * Every draft id a yes may bind for these rows: each row, and transitively each cut the register records it re-cut —
 * `recuts`, what `--supersedes` named, and an approval's `inheritedFrom`. Equal words are NOT lineage here: a row
 * already parked is approved on its own card or one it re-cut, never on a twin's.
 *
 * @param items the register's rows
 * @param targetIds the rows the yes is being recorded on
 * @returns the ids, the targets first
 */
export function draftApprovalBindingIds({
  items,
  targetIds,
}: {
  items: readonly SlackDraftItem[];
  targetIds: readonly string[];
}): ReadonlySet<string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const pending = [...targetIds];
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const item = byId.get(id);
    if (item === undefined) {
      continue;
    }
    if (item.draft.recuts !== undefined) {
      pending.push(...item.draft.recuts);
    }
    const inherited = item.draft.approval?.inheritedFrom;
    if (inherited !== undefined) {
      pending.push(inherited);
    }
  }
  return seen;
}

/**
 * The drafts the card the owner's words were said over named: a `post:` card's own id, or the ids an ask or hand card's
 * landing kept. What a fresh recording may bind to when it carries one of those rows' exact words.
 *
 * @param context what the record holding the owner's words says they were about
 * @returns the ids, empty when the record names no draft
 */
export function draftApprovalCardIds({ context }: { context: RawWordsContext }): readonly string[] {
  let card: string;
  if (context.kind === "relay") {
    card = context.about;
  } else if (context.kind === "card-landing") {
    card = context.cardKey;
    if (!card.startsWith(POST_CARD) && context.draftIdsUnread === undefined && context.draftIds !== undefined) {
      return context.draftIds;
    }
  } else {
    return [];
  }
  if (card.startsWith(POST_CARD) && card.length > POST_CARD.length) {
    return [card.slice(POST_CARD.length)];
  }
  return [];
}

/**
 * Why the owner's words at an anchor do not bind as their yes to a draft, or `undefined` when nothing the record says stops it.
 * The verdict is checked first, so a relay that ruled otherwise is refused naming that ruling; then the affirmative
 * act, so a remark over this draft's own card is refused as not a yes rather than passing on the card alone.
 *
 * @param allowedDraftIds the draft and its recorded lineage ({@link draftApprovalBindingIds})
 * @param claimed how the caller's flag spelled the anchor, for the refusal
 * @param context what the record holding the owner's words says they were about
 * @param heard the owner's words at the anchor, read for a yes when the record carries no ruling
 * @returns the refusal, or `undefined`
 */
export function draftApprovalAnchorError({
  allowedDraftIds,
  claimed,
  context,
  heard,
}: {
  allowedDraftIds: ReadonlySet<string>;
  claimed: string;
  context: RawWordsContext;
  heard: string;
}): DraftApprovalAnchorError | undefined {
  if (context.kind === "relay") {
    return relayAnchorError({ allowedDraftIds, claimed, context, heard });
  }
  if (context.kind === "card-landing") {
    const notAYes = noAffirmativeError({ claimed, heard });
    if (notAYes !== undefined) {
      return notAYes;
    }
    return landingError({ allowedDraftIds, claimed, context });
  }
  return undefined;
}

/** {@link draftApprovalAnchorError} for a relay: its stored verdict, then for an unruled one the owner's words, then its card. */
function relayAnchorError({
  allowedDraftIds,
  claimed,
  context,
  heard,
}: {
  allowedDraftIds: ReadonlySet<string>;
  claimed: string;
  context: Extract<RawWordsContext, { kind: "relay" }>;
  heard: string;
}): DraftApprovalAnchorError | undefined {
  const ruling = context.triageRuling;
  if (ruling === undefined) {
    return DraftApprovalAnchorErrors.verdict({ claimed, verdict: undefined });
  }
  if (ruling !== null && ruling.verdict !== "send-it") {
    return DraftApprovalAnchorErrors.verdict({ claimed, verdict: ruling.verdict });
  }
  // A send-it ruling IS the affirmative act — the owner's words may be a bare "yep" — so only an unruled relay is word-read.
  const notAYes = ruling === null ? noAffirmativeError({ claimed, heard }) : undefined;
  if (notAYes !== undefined) {
    return notAYes;
  }
  return postCardError({ allowedDraftIds, card: context.about, claimed, what: "the relay" });
}

/** The refusal when the words at the anchor are not an affirmative act. */
function noAffirmativeError({
  claimed,
  heard,
}: {
  claimed: string;
  heard: string;
}): DraftApprovalNoAffirmativeError | undefined {
  const why = affirmativeActWhy({ text: heard });
  if (why === undefined) {
    return undefined;
  }
  return DraftApprovalAnchorErrors.noAffirmative({ claimed, heard, why });
}

/** The words a later relay is quoted by: whichever record carries the take-back, the turn file's when both or neither. */
function quotedWords({ relay }: { relay: ApprovalLaterRelay }): string {
  if (!carriesTakeBack({ text: relay.heard }) && carriesTakeBack({ text: relay.callHeard })) {
    return relay.callHeard;
  }
  return relay.heard;
}

/**
 * Why a relay the owner made AFTER the yes, on the same call, stops it binding — or `undefined` when none does. A later relay
 * refuses when it contradicts the yes (a take-back phrase, a verdict other than send-it, or no ruling at all over no
 * card or the yes's own card) AND names no card of its own. It names its own card only when it is about a card other
 * than the yes's, with a ruling of its own on that card: card N send-it then card N+1 needs-more-info is an ordinary
 * pass, never a take-back. A send-it on the yes's own card is the yes said again. Words decide only for an unruled
 * aside on another card, so the open vocabulary of a take-back is left where an aside is common. The
 * first refusing relay, in call order, is the one named.
 *
 * @param anchorCard the card the yes was said over
 * @param claimed how the caller's flag spelled the anchor, for the refusal
 * @param laterRelays the relays after the yes in its window (`../../../talk/approvalRelayRead.ts`)
 * @returns the refusal, or `undefined`
 */
export function draftApprovalLaterRelayError({
  anchorCard,
  claimed,
  laterRelays,
}: {
  anchorCard: string;
  claimed: string;
  laterRelays: readonly ApprovalLaterRelay[];
}): DraftApprovalLaterRelayError | undefined {
  const refusing = laterRelays.find((relay) => {
    // A ruling on words that may stop short is read as none: it can still refuse, never stand the yes (`relayCutHold`).
    const ruling = relay.wordsWhole ? relay.triageRuling : null;
    if (ruling?.verdict === "send-it" && relay.about === anchorCard) {
      return false;
    }
    const otherVerdict = ruling !== null && ruling.verdict !== "send-it";
    const tookBack = carriesTakeBack({ text: relay.heard }) || carriesTakeBack({ text: relay.callHeard });
    const unruledOffAnotherCard = ruling === null && (relay.about === "" || relay.about === anchorCard);
    const contradicts = otherVerdict || tookBack || unruledOffAnotherCard;
    // Only a real card key is a card to own: a ruling over "not-a-card" rules nothing.
    const ownsItsCard = CARD_KEY.test(relay.about) && relay.about !== anchorCard && ruling !== null;
    return contradicts && !ownsItsCard;
  });
  if (refusing === undefined) {
    return undefined;
  }
  return DraftApprovalAnchorErrors.laterRelay({
    about: refusing.about,
    cardDistance: refusing.cardDistance,
    claimed,
    heard: quotedWords({ relay: refusing }),
    laterAnchor: `talk:${refusing.turnId}`,
    // The ruling as the decision read it: on words not stated whole, none, never the stored verdict.
    verdict: !refusing.wordsWhole || refusing.triageRuling === null ? null : refusing.triageRuling.verdict,
  });
}

/**
 * The four lines a refused approval prints, in the shape `.claude/rules/error-handling.md` gives every policy refusal,
 * with the third saying there is no hatch rather than leaving its absence to read as forgotten.
 *
 * @param command the verb that refused, as the operator typed it
 * @param error what the record contradicts
 * @returns the refusal's four lines
 */
export function draftApprovalRefusalLines({
  command,
  error,
}: {
  command: string;
  error: DraftApprovalAnchorError;
}): readonly string[] {
  return [
    `${command} blocked because ${error.message}.`,
    "Legitimate exceptions may include a relay the owner made over this draft's own card with the send-it verdict; an " +
      'unruled relay or a card landing on it whose words carry a yes ("yes", "send it", "looks good") and no ' +
      "take-back; the owner's yes landing on an ask or hand card that named this draft as they spoke; a re-cut whose ancestor's card carried the owner's " +
      "yes; a fresh recording of the exact words of the row whose card the owner spoke on; a later relay on the same call " +
      "that rules the next card with a verdict of its own.",
    "There is deliberately NO escape hatch: an override would bind a yes the owner's own record says they did not give to this " +
      "draft, and recording the yes they give on its card is always available.",
    JUDGEMENT_NOTE,
  ];
}

/** A relay's card: it must be the `post:` card of an allowed draft. */
function postCardError({
  allowedDraftIds,
  card,
  claimed,
  what,
}: {
  allowedDraftIds: ReadonlySet<string>;
  card: string;
  claimed: string;
  what: string;
}): DraftApprovalCardMismatchError | undefined {
  if (card === "") {
    return mismatch({ about: "", allowedDraftIds, claimed, why: `${what} was about no card` });
  }
  if (card.startsWith(POST_CARD) && allowedDraftIds.has(card.slice(POST_CARD.length))) {
    return undefined;
  }
  return mismatch({ about: card, allowedDraftIds, claimed, why: `${what} was about ${card}` });
}

/** A landing's card: an allowed `post:` card, or an ask or hand card whose landing kept an allowed id. */
function landingError({
  allowedDraftIds,
  claimed,
  context,
}: {
  allowedDraftIds: ReadonlySet<string>;
  claimed: string;
  context: Extract<RawWordsContext, { kind: "card-landing" }>;
}): DraftApprovalCardMismatchError | undefined {
  const { cardKey } = context;
  if (cardKey.startsWith(POST_CARD)) {
    return postCardError({ allowedDraftIds, card: cardKey, claimed, what: "the landing" });
  }
  const namesDrafts = cardKey.startsWith("ask:") || cardKey.startsWith("hand:");
  if (!namesDrafts) {
    return mismatch({ about: cardKey, allowedDraftIds, claimed, why: `the landing was on ${cardKey}` });
  }
  if (context.draftIdsUnread !== undefined) {
    const why = `the landing was on ${cardKey}, whose drafts would not read as the owner spoke (${context.draftIdsUnread})`;
    return mismatch({ about: cardKey, allowedDraftIds, claimed, why });
  }
  if (context.draftIds === undefined) {
    const why = `the landing on ${cardKey} predates keeping the drafts its card named`;
    return mismatch({ about: cardKey, allowedDraftIds, claimed, why });
  }
  if (context.draftIds.some((id) => allowedDraftIds.has(id))) {
    return undefined;
  }
  const why = `the landing was on ${cardKey}, which named ${context.draftIds.join(", ")} as the owner spoke`;
  return mismatch({ about: cardKey, allowedDraftIds, claimed, why });
}

/** The card refusal, naming what the anchor was about and what a yes here would bind. */
function mismatch({
  about,
  allowedDraftIds,
  claimed,
  why,
}: {
  about: string;
  allowedDraftIds: ReadonlySet<string>;
  claimed: string;
  why: string;
}): DraftApprovalCardMismatchError {
  return DraftApprovalAnchorErrors.cardMismatch({ about, claimed, expectedDraftIds: [...allowedDraftIds], why });
}
