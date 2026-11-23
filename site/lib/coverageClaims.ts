/**
 * The sentences of a thinking-model answer that claim a WHOLE read or a TOTAL — "I've read the whole briefing", "that's
 * everything on it", "eleven in total" — which the plan call holds back from the voice while a read the answer rests on
 * still stands cut (`./coverageHold.ts`). Pure.
 *
 * Unsupported claims of completeness or totals are blocked before
 * being spoken. The recorded cases this reads are the read-gap page's "read part, spoke as if whole" class: a
 * briefing said to have worked, "that covers fourteen cards" with 29 showing, a partial read not mentioned.
 *
 * ## What reads as a claim, and the trade
 *
 * A sentence claims the whole when it says it read, went through or covered all of something, names the whole, entire
 * or full of a source, or closes a list ("that's everything", "nothing else", "that's the last one", "that covers"); it
 * claims a total when it says "in total", "altogether", "in all", "a total of", or "all" before a number. A sentence
 * that hedges — a negation, "only", "part", "so far", "yet" — is never one: "I couldn't read the
 * whole briefing" is the honest answer this exists to protect, so holding it would invert the rule. The trade is that a
 * claim phrased any other way is not seen; the after-speech checks (`./talkCountGrounding.ts`,
 * `./talkSpokenClaims.ts`) still run behind this.
 */

/** A sentence that claims the whole of a read, or a total. */
const CLAIMS: readonly RegExp[] = [
  /\b(?:read|went through|gone through|covered|looked through|checked)\s+(?:it\s+|them\s+)?(?:all|everything|every\b)/i,
  /\b(?:read|went through|gone through|covered|looked through|checked)\s+(?:the|your|that|this)\s+(?:whole|entire|full)\b/i,
  /\b(?:the|your|that|this)\s+(?:whole|entire|full)\s+(?:thing|briefing|page|card|thread|file|document|doc|list|queue|log|transcript)\b/i,
  /\b(?:that's|that is|those are|it's)\s+(?:everything|all of (?:it|them)|the last one|the lot)\b/i,
  /\bnothing else\b|\bthat covers\b/i,
  /\b(?:from\s+(?:the\s+)?(?:beginning|start|top)\s+to\s+(?:the\s+)?(?:end|finish|bottom)|start to finish|cover to cover|end to end)\b/i,
  /\b(?:in total|altogether|in all|a total of)\b/i,
  /\ball\s+(?:\d+|[a-z]+(?:-[a-z]+)?)\s+(?:cards|items|messages|briefings|files|replies|rows|sections|pages|asks)\b/i,
];

/** Words that make a sentence a hedge, never a claim. */
const HEDGE = /\b(?:not|never|no|only|part|partly|partial|so far|cannot|unable|yet)\b|n't\b/i;

/**
 * Every sentence of an answer that claims a whole read or a total, in the order written.
 *
 * @param text the answer the thinking model wrote
 * @returns the claiming sentences, trimmed; empty when none claims
 */
export function coverageClaimsOf({ text }: { text: string }): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "" && !HEDGE.test(sentence) && CLAIMS.some((claim) => claim.test(sentence)));
}
