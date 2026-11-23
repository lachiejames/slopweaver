/**
 * Which proof the owner asked for on a pull request the card is about, and the body still lacks — the console half of the
 * verdict `handover currency` records (`src/handover/prProof.ts`). A card that is about such a pull request LEADS
 * with the gap, ahead of its question: the question a card asks can skip what the owner already asked for, and answering it
 * without seeing the gap is how an ask of the owner's goes unmet a second time.
 *
 * A card is about a pull request when the board row it opens names it (the verdict's `rowSlugs`), or when it IS the
 * pull request's own card. Only an unmet verdict leads; a met one and a body the tick could not read draw nothing
 * here, since "not checked" over a card is the currency mark's to say, never a gap's.
 */
import type { CurrencyProofKind, CurrencyReading } from "./cardCurrency";

/** Every proof kind, in the producer's order — bound to `PROOF_KINDS` by `prProofMirror.test.ts`. */
export const CURRENCY_PROOF_KINDS: readonly CurrencyProofKind[] = ["image", "run-link", "datadog"];

/** How each kind is named — bound to `PROOF_KIND_WORDS` by `prProofMirror.test.ts`. */
export const PROOF_KIND_WORDS: Readonly<Record<CurrencyProofKind, string>> = {
  datadog: "Datadog link",
  image: "screenshot",
  "run-link": "Actions run link",
};

/** One gap a card leads with. */
export interface ProofGap {
  readonly identity: string;
  /** The collapsed row's line: what is missing, on which pull request. */
  readonly short: string;
  /** The opened card's line: the producer's sentence, carrying the owner's words and when they said them. */
  readonly sentence: string;
}

/** The part of a Queue row the match reads. */
export interface ProofCard {
  /** The row's key and every alias it answers to — an `ask:<slug>` among them names the board row it opens. */
  readonly keys: readonly string[];
  /** On a pull request's own card, `owner/repo#number`; `undefined` on every other card. */
  readonly pullRequest: string | undefined;
  /**
   * Every pull request the board row the card opens names NOW (its `prNamed`). A verdict joined by slug must be about
   * one of these: the reading is a tick old and a slug is reused. `undefined` when the card opens no board
   * row, or the row published none — no verdict then joins by slug.
   */
  readonly named: readonly string[] | undefined;
}

/**
 * Every unmet proof ask on a pull request this card is about, in the reading's order.
 *
 * @param card the row's keys and, on a pull request's own card, its address
 * @param reading the last recorded currency reading, or `undefined` when none has arrived
 * @returns the gaps; empty when the card is about no such pull request, or the reading carries no verdicts
 */
export function proofGapsOf({
  card,
  reading,
}: {
  card: ProofCard;
  reading: CurrencyReading | undefined;
}): readonly ProofGap[] {
  if (reading?.pullRequests === undefined) {
    return [];
  }
  const slugs = new Set(card.keys.filter((key) => key.startsWith("ask:")).map((key) => key.slice("ask:".length)));
  const own = card.pullRequest?.toLowerCase();
  const gaps: ProofGap[] = [];
  for (const pr of reading.pullRequests) {
    if (pr.proof.kind !== "requested-and-unmet") {
      continue;
    }
    const namedNow = card.named?.includes(pr.identity) === true;
    const about = pr.identity === own || (namedNow && pr.rowSlugs.some((slug) => slugs.has(slug)));
    if (!about) {
      continue;
    }
    const missing = pr.proof.missing.map((kind) => PROOF_KIND_WORDS[kind]).join(", ");
    gaps.push({
      identity: pr.identity,
      sentence: pr.proof.gap,
      short: `Still missing the proof you asked for on ${pr.identity}: ${missing}`,
    });
  }
  return gaps;
}
