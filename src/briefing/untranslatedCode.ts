/**
 * A card's heading leads with what a thing MEANS, and a machine code in it follows the words saying what it is.
 *
 * A card states meaning rather than facts, because every fact the owner has to translate into meaning is friction.
 * A bare code such as "network segregation 2.1 and 3" gives no hint whether it is a control code or an ISO clause.
 * A code is the purest case of a fact the owner has to translate: `NET-93`, `A.8.22` or `2.1 and 3` names something
 * only once the owner has looked it up.
 *
 * **The criterion is ORDER, not absence.** A code inside parentheses or brackets passes, because there it is the
 * reference after the meaning — `Segregation of networks (NET-93)` reads, `NET-93` does not. A code inside a URL
 * passes, because the address is the link and never the words. Everything else in the closed set below is refused
 * where the card is BUILT (`../handover/cardAlignment.ts` for an ask's heading, `../hand/headlineCode.ts` for a hand
 * step's), never by review. Whether a code is LINKED is a different rule with its own gate; this one only asks that
 * the heading says what the thing is before it names it.
 *
 * **The families are a closed set, each a shape a person cannot read:**
 *
 * - a team key — a Vanta control or test (`NET-93`), a Linear issue (`RRRR-589`), an incident (`INC-33`). Two parts
 *   only: a three-part public id (`CVE-2026-47429`) is not one, and an ask that names its finding that way after
 *   saying what it is passes;
 * - an ISO Annex clause, `A.8.22`;
 * - a list of section numbers, `2.1 and 3` — words a reader cannot place;
 * - a parked draft's id, `sd-` and eight hex characters;
 * - a review pass or property id, a letter, a digit, a hyphen and two digits;
 * - a hex id of eight or more characters mixing digits and letters — a commit, a session, a run or a call;
 * - a voice turn or relay id, `turn_` and a long token, or `talk-` and twelve hex characters.
 *
 * **A tell, deliberately over-broad on the team key**: `GPT-4` and `UTC-5` match it. The fix a false refusal asks for
 * is one pair of parentheses or one word of meaning, which is the trade `../hand/headlinePurpose.ts` makes too.
 *
 * MEASURED over every heading a card was ever built from: 119 of the 869 distinct recorded question leads
 * carry an untranslated code (84 a hex id, 35 a team key, 14 a draft id, 2 a review pass id — counted per code), and
 * 3 of the 216 distinct posted hand headlines do (the Vanta evidence drafts card, an incident page, a Linear chip
 * try-out). Every team key it found was a real Linear, Vanta or incident key; no section-number list or ISO clause
 * had reached a heading, the unplaceable words having sat on the card's body and its page. Reproduce by
 * replaying the first two sentences (`./text.ts`'s `splitSentences`) of every `"kind":"question"` and
 * `"kind":"question-corrected"` line in `$SLOPWEAVER_HOME/runs/*.jsonl`, and the `what` of every `"posted"` line in
 * `$SLOPWEAVER_HOME/hand-steps/steps.jsonl`, through {@link untranslatedCodes}.
 *
 * Pure: a string in, the codes out.
 */

/** One family of machine code, with the shape that finds it. */
interface CodeFamily {
  /** What the code is, in the words a refusal uses. */
  readonly kind: string;
  readonly pattern: RegExp;
}

/** The closed set — see the module header. Order is the order a refusal names them in. */
const FAMILIES: readonly CodeFamily[] = [
  { kind: "a section-number list", pattern: /\b\d+\.\d+(?:,\s*\d+(?:\.\d+)*)*,?\s+and\s+\d+(?:\.\d+)*\b/gu },
  { kind: "an ISO clause", pattern: /\bA\.\d+(?:\.\d+)+\b/gu },
  { kind: "a draft id", pattern: /\bsd-[0-9a-f]{8}\b/gu },
  { kind: "a review pass id", pattern: /\br\d-\d{2}\b/gu },
  { kind: "a voice turn or relay id", pattern: /\b(?:turn_[A-Za-z0-9]{8,}|talk-[0-9a-f]{8,})\b/gu },
  { kind: "a team key", pattern: /\b[A-Z][A-Z0-9]{1,5}-\d+\b(?!-\d)/gu },
  { kind: "a hex id", pattern: /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gu },
];

/** A web address, removed before matching: a code in a path is the link, never the words. */
const URL = /\bhttps?:\/\/\S+|\bfile:\/\/\S+/gu;

/** A parenthesised or bracketed span, innermost first — where a code is the reference after its meaning. */
const ENCLOSED = /\([^()]*\)|\[[^[\]]*\]/gu;

/** One code a heading names before saying what it is. */
export interface UntranslatedCode {
  /** The code as written. */
  readonly code: string;
  /** Its family, in a refusal's words. */
  readonly kind: string;
}

/**
 * The text with every web address and every parenthesised or bracketed span blanked, so what is left is what a reader
 * meets as words.
 *
 * @param text the heading
 * @returns the bare words, each removed span replaced by one space so neighbours never fuse into a code
 */
function bareWords({ text }: { text: string }): string {
  let bare = text.replace(URL, " ");
  let previous = "";
  while (previous !== bare) {
    previous = bare;
    bare = bare.replace(ENCLOSED, " ");
  }
  return bare;
}

/**
 * Every machine code a heading names outside parentheses, brackets or an address, first family first and each code
 * once.
 *
 * @param text the heading a card is about to be built from
 * @returns the codes, empty when every code follows the words saying what it is
 */
export function untranslatedCodes({ text }: { text: string }): readonly UntranslatedCode[] {
  let rest = bareWords({ text });
  const found: UntranslatedCode[] = [];
  for (const family of FAMILIES) {
    for (const match of rest.matchAll(family.pattern)) {
      if (!found.some((seen) => seen.code === match[0])) {
        found.push({ code: match[0], kind: family.kind });
      }
    }
    // A code one family claimed is never claimed again by a broader one (`NET-93` inside `2.1 and 3` cannot occur,
    // but a hex run inside a draft id can).
    rest = rest.replace(family.pattern, " ");
  }
  return found;
}

/**
 * The one sentence a refusal prints for the codes a heading names untranslated.
 *
 * @param codes what {@link untranslatedCodes} found, never empty
 * @returns the reason, naming each code and its family, and the shape that passes
 */
export function untranslatedCodeReason({ codes }: { codes: readonly UntranslatedCode[] }): string {
  const named = codes.map(({ code, kind }) => `"${code}" (${kind})`).join(", ");
  return (
    `it names ${named} before saying what ${codes.length === 1 ? "it is" : "they are"} — the owner has to translate a code ` +
    "into meaning, so say what the thing is first and put the code in parentheses after it " +
    '("Segregation of networks (NET-93)", "the network-separation sections (2.1 and 3)")'
  );
}
