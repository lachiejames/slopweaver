/**
 * Whether the owner's finished words ask the walk to move on to the next card — read off THE OWNER'S words, never the voice's, so a
 * hand-off the voice drops still owes the turn (`./talkPlanOwedTurn.ts`, why `walk`).
 *
 * Measured: the owner said "All right, next card please" while the voice was saying a held answer; it replied
 * "Pulling it up now. Okay, got it here." and started nothing, the page's promise press read that as no promise, and
 * the card the owner had finished stayed up 40s until their own nudge.
 * Every shape below was measured on a call; repro over every call file:
 * `grep -rhoiE '"text":"[^"]*next (queue |cue )?(card|one)[^"]*","who":"h[i]m"' $SLOPWEAVER_HOME/talk/calls/`.
 *
 * Bounded on purpose: only the LAST clause counts, and it must be the ask and nothing else, so "the next card asks
 * about backups" or "is that the next one?" never reads as one. A miss leaves the voice's own hand-off and the owner's nudge,
 * exactly as before; a false read starts a turn whose words tell the thinking model to judge the owner's words first.
 */

/** Words they open a clause with that say nothing: "all right, next card", "um, anyway, next one". */
const FILLER = String.raw`(?:all right|alright|right|okay|ok|cool|sounds good|great|good|yeah|yep|yes|nope|nah|no|well|anyway|so|and|then|um+|uh+|mm-hm|sure|thanks|thank you)`;

/** The polite opening a request takes, which a transcript ends with a "?": "could you take me to the next card?". */
const POLITE = String.raw`(?:can|could|would) you\s+`;

/** What they ask the walk to do before "the next card": "take me to", "move on to", "let's go on to". */
const MOVE = String.raw`(?:please\s+)?(?:(?:take|bring|move|get)\s+(?:me|us)\s+(?:on\s+)?to|(?:let['’]?s\s+)?(?:go|move)\s+on\s+to|on\s+to|onto|show\s+me|open|pull\s+up|give\s+me)`;

/** The card they ask for: "next card", "the next queue card", "next one", "next cue card". */
const NEXT = String.raw`(?:the\s+)?next(?:\s+(?:queue|cue|q))?\s+(?:card|one)`;

/** The clause's opening filler, and its closing "please". */
const OPENING = String.raw`^(?:${FILLER}[,.]?\s+)*`;
const CLOSING = String.raw`(?:[,.]?\s*please)?$`;

/** One whole clause that asks for the next card and nothing else. */
const WALK_CLAUSE = new RegExp(
  String.raw`${OPENING}(?:(?:${POLITE}|we\s+(?:can|could)\s+)?${MOVE}\s+)?${NEXT}${CLOSING}`,
  "iu",
);

/**
 * The one shape of the ask a "?" may end: a polite request, "can you open the next one?". Any other question, "is
 * that the next one?" or "what's the next card?", asks about the card rather than to move.
 */
const POLITE_WALK_CLAUSE = new RegExp(String.raw`${OPENING}${POLITE}${MOVE}\s+${NEXT}${CLOSING}`, "iu");

/**
 * What closes a clause: a mark, or a joining "and"/"then" ("…this next summary and we could move on to next card").
 * A spaced hyphen closes one too ("keep this one - next card please"), never the one inside
 * "mm-hm". A "?" closes an earlier clause ("are we finished? next card please"); a closing one is
 * stripped first, since only a polite request may end on one.
 */
const CLAUSE_BREAK = /[.!?;,…—–]+|\s+-+\s+|\s+(?:and|then)\s+/iu;

/** A word said twice running, as speech stutters and a transcript keeps it: "get get me to the next card". */
const STUTTER = /\b([\p{L}']+)(?:\s+\1\b)+/giu;

/**
 * Whether the owner's finished words end on an ask for the next card.
 *
 * @param text the owner's final transcript for the utterance
 * @returns true when its last clause asks the walk to move on, and nothing else
 */
export function walkAskOf({ text }: { text: string }): boolean {
  const trimmed = text.trim().replace(/[.!\s]+$/u, "");
  const asked = trimmed.endsWith("?");
  // "Next card, please" keeps its "please" with the ask, which the clause split would otherwise strand alone.
  const joined = trimmed
    .replace(/[?\s]+$/u, "")
    .replace(/,\s*please$/iu, " please")
    .replace(STUTTER, "$1");
  const clauses = joined
    .split(CLAUSE_BREAK)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== "");
  const last = clauses.at(-1);
  const clause = asked ? POLITE_WALK_CLAUSE : WALK_CLAUSE;
  return last !== undefined && clause.test(last);
}
