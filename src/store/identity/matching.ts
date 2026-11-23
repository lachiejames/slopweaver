/**
 * The pure string comparisons identity resolution is built on — email, name, and the edit distance under
 * both.
 *
 * ## Ported design, re-implemented
 *
 * Owner ruling: identity resolution is a first-class feature, and the Slopweaver archive
 * already solved it once. The archive carries an entity graph whose matcher
 * normalises an email, normalises a name, and scores the pair on a token overlap OR a Levenshtein
 * similarity, whichever is kinder. This module is that design re-implemented in this repo's idiom per
 * AGENTS.md § "Porting from private sources" — named object parameters, explicit returns, no shared
 * error base — rather than its code moved across.
 *
 * ## What is deliberately different, and why
 *
 * The archive returned a bare number from every one of these and left each caller to pick a threshold.
 * Here the numbers stay, and the DECISION is made in exactly one place ({@link ./resolve}), because a
 * threshold chosen at a call site is a threshold nobody can find later. Everything in this file is a
 * measurement; nothing in it decides anything.
 *
 * Every function here is total and pure: no clock, no database, no I/O. That is what lets the whole
 * resolution ladder be unit-tested over real handles with no Postgres anywhere near it.
 *
 * The edit distance itself now lives in {@link ../../lib/editDistance} and is re-exported here, because
 * {@link ../../silver/nearMention} needed the same measurement and a second copy of it in this tree is the
 * `tsToIso` class. Callers of `levenshteinDistance`/`stringSimilarity` are unaffected.
 */
import { stringSimilarity } from "#lib/editDistance.js";

export { levenshteinDistance, stringSimilarity } from "#lib/editDistance.js";

/**
 * Reduce an email to the form two spellings of the same mailbox share.
 *
 * Plus-addressing is stripped everywhere because every major provider treats it as routing rather than
 * identity; dots are stripped for Gmail ONLY, because that is the one provider that documents them as
 * insignificant, and doing it universally would merge two genuinely different mailboxes on a host that
 * distinguishes them.
 *
 * @param email the address as its platform spelled it
 * @returns the comparable form, lowercased and with the routing decorations removed
 */
export function normalizeEmail({ email }: { email: string }): string {
  const trimmed = email.toLowerCase().trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return trimmed;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  // Index 0 always exists: splitting a string on a non-empty separator yields at least one element.
  const withoutTag = local.split("+")[0]!;
  const cleaned = domain === "gmail.com" ? withoutTag.replaceAll(".", "") : withoutTag;
  return `${cleaned}@${domain}`;
}

/**
 * Reduce a display name to the form two spellings of the same person share.
 *
 * @param name the name as its platform displays it
 * @returns the name lowercased, without titles, punctuation or repeated whitespace
 */
export function normalizeName({ name }: { name: string }): string {
  const titles = new Set(["mr", "mrs", "ms", "mx", "dr", "prof", "sir", "miss", "esq"]);
  const stripped = name
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return stripped
    .split(" ")
    .filter((token) => token.length > 0 && !titles.has(token))
    .join(" ");
}

/**
 * How alike two email addresses are, once their routing decorations are gone.
 *
 * A shared domain lifts the floor rather than deciding the answer: two addresses at the same company
 * are more likely to be one person than two at different ones, and much less likely than two that
 * normalise to the same mailbox.
 *
 * @param left one address
 * @param right the other
 * @returns 1 for a literal match, 0.95 once normalised, and a domain-weighted similarity otherwise
 */
export function emailSimilarity({ left, right }: { left: string; right: string }): number {
  if (left.toLowerCase().trim() === right.toLowerCase().trim()) {
    return 1;
  }
  const a = normalizeEmail({ email: left });
  const b = normalizeEmail({ email: right });
  if (a === b) {
    return 0.95;
  }
  const aAt = a.lastIndexOf("@");
  const bAt = b.lastIndexOf("@");
  if (aAt <= 0 || bAt <= 0) {
    return 0;
  }
  const locals = stringSimilarity({ left: a.slice(0, aAt), right: b.slice(0, bAt) });
  if (a.slice(aAt + 1) === b.slice(bAt + 1)) {
    return locals * 0.7 + 0.3;
  }
  return locals * 0.3;
}

/**
 * Whether two name tokens plausibly denote the same word, allowing an initial for a full given name.
 *
 * @returns whether either token is a prefix of the other, or they share an initial when one is a bare letter
 */
function tokensAgree({ left, right }: { left: string; right: string }): boolean {
  if (left === right) {
    return true;
  }
  if (left.length === 1 || right.length === 1) {
    return left[0] === right[0];
  }
  return left.startsWith(right) || right.startsWith(left);
}

/**
 * How alike two display names are, by token overlap or by edit distance, whichever is kinder.
 *
 * Both measures are kept because each catches what the other misses: "Sadie C." against "Sadie Chen"
 * scores badly on edit distance and well on tokens, and "Sadi Chen" against "Sadie Chen" the other way
 * round. Taking the maximum is what the archive did and it is the right shape — this is a candidate
 * generator, and a missed candidate is invisible while a spurious one is reviewed.
 *
 * @param left one display name
 * @param right the other
 * @returns the similarity, on a scale where 1 is identical after normalisation
 */
export function nameSimilarity({ left, right }: { left: string; right: string }): number {
  const a = normalizeName({ name: left });
  const b = normalizeName({ name: right });
  if (a === b) {
    return a.length === 0 ? 0 : 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const aTokens = a.split(" ");
  const bTokens = b.split(" ");
  const agreed = aTokens.filter((token) => bTokens.some((other) => tokensAgree({ left: token, right: other })));
  const overlap = (2 * agreed.length) / (aTokens.length + bTokens.length);
  return Math.max(overlap, stringSimilarity({ left: a, right: b }));
}
