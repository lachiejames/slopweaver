/**
 * The NEAR pass — who in the member index is spelled close to a token the exact ladder could not match.
 *
 * ## Why it exists
 *
 * MEASURED: `slopweaver identity resolve 'Tobyn Barten'` answered _"no colleague in the member
 * index answers to Tobyn Barten"_ and added _"member bronze is every provider's own member list, so this is a
 * real absence, not a stale roster."_ The member index held that colleague the whole time, as **Tobin Barton** —
 * `slack:U0SYN000030`, `tobin@acme.com`, three sources — with 13,017 bronze records authored by that person.
 * Two letters.
 *
 * The miss was never the defect. {@link ./mentionResolver} matches exactly on purpose, and it should: the
 * worst outcome available to an addressing layer is a confident wrong person. The defect was the SENTENCE.
 * A session that reads "this is a real absence" correctly concludes the person is not in the corpus and
 * stops investigating, which is exactly what happened.
 *
 * ## What this returns, and what it is not allowed to become
 *
 * SUGGESTIONS. Never an answer. Nothing here feeds {@link ./mentionResolver.lookupMention}, nothing here can
 * change what a token resolves to, and no caller may promote a near match to a resolution — the two-letter
 * gap that makes "Tobyn Barten" a near miss for "Tobin Barton" makes it an equally near miss for a different
 * colleague spelled "Tobyn Barten**s**", and picking between them is a human's call. The whole safety
 * argument for a fuzzy pass in a repository whose identity layer is deliberately exact is that this one is
 * read by a person or an agent who then re-runs the exact verb with the spelling they meant.
 *
 * That is also why {@link ./personLookup.normaliseName}'s note — "never for fuzzy matching, since guessing
 * at who was meant is how the wrong person gets tagged" — still holds. Nobody is tagged from here.
 *
 * ## The budget, and why it is zero on a short token
 *
 * A near match is reported when the edit distance to a candidate string is inside a budget scaled by the
 * longer of the two:
 *
 *   - **4 characters or fewer: no budget at all.** One edit reaches an enormous neighbourhood of real,
 *     different names at that length — `ada`/`ida`, `tom`/`tim`, `jon`/`jan` — so a suggestion there is
 *     noise that reads like a lead.
 *   - **5 to 8: one edit.** A single transposed or dropped letter.
 *   - **9 or more: two edits.** What `tobyn barten` → `tobin barton` costs: one substitution in each word.
 *
 * Bots are excluded outright rather than tier-gated. {@link ./mentionResolver.tierAllowsBot} already refuses
 * to match a bot by NAME, and a FUZZY identifier match is worth less than an exact one is: a handle or an
 * address one edit away from a bot's is not evidence the caller meant that bot, so nothing here could
 * arrive as anything but noise.
 *
 * Pure — the caller injects the folded people.
 */
import { levenshteinDistance } from "#lib/editDistance.js";
import type { MentionPerson } from "./mentionResolver.js";
import { nameTokens } from "./mentionResolver.js";
import { normaliseEmail, normaliseHandle, normaliseName } from "./personLookup.js";

/** Which spelling of a person the token came close to. */
export type NearField = "full-name" | "name-part" | "handle" | "email";

/** How many near matches a caller is handed at most, so a loose token cannot print a roster. */
export const NEAR_MATCH_LIMIT = 5;

/** A person the token nearly spelled, and the evidence for saying so. */
export interface NearMatch {
  readonly person: MentionPerson;
  /** Which kind of spelling matched. */
  readonly field: NearField;
  /** The candidate spelling itself, normalised — what the distance was actually measured against. */
  readonly value: string;
  /** The edit distance between the normalised token and {@link value}; always at least 1. */
  readonly distance: number;
}

/**
 * The edit budget for comparing against a candidate of a given length. See the module note for why a short
 * token gets none. Pure.
 *
 * @param length the longer of the two strings being compared
 * @returns the largest edit distance that still counts as "spelled near"
 */
export function nearEditBudget({ length }: { length: number }): number {
  if (length <= 4) {
    return 0;
  }
  if (length <= 8) {
    return 1;
  }
  return 2;
}

/**
 * Every normalised spelling of a person, tagged with which kind it is, deduped by VALUE.
 *
 * The identifier fields go first, and that order decides the label when two kinds share a spelling — a
 * colleague whose handle is also their given name. `handle` is the more actionable of the two labels,
 * because it is the thing the reader re-runs the exact lookup with.
 */
function spellingsOf({ person }: { person: MentionPerson }): readonly { field: NearField; value: string }[] {
  const seen = new Set<string>();
  const out: { field: NearField; value: string }[] = [];
  const add = ({ field, value }: { field: NearField; value: string }): void => {
    if (value.length === 0 || seen.has(value)) {
      return;
    }
    seen.add(value);
    out.push({ field, value });
  };
  for (const identity of person.identities) {
    if (identity.handle !== undefined) {
      add({ field: "handle", value: normaliseHandle({ handle: identity.handle }) });
    }
    if (identity.email !== undefined) {
      const email = normaliseEmail({ email: identity.email });
      add({ field: "email", value: email });
      const local = email.split("@")[0];
      if (local !== undefined) {
        add({ field: "email", value: local });
      }
    }
  }
  for (const identity of person.identities) {
    if (identity.name !== undefined) {
      const tokens = nameTokens({ name: identity.name });
      add({ field: "full-name", value: tokens.whole });
      tokens.parts.forEach((part) => {
        add({ field: "name-part", value: part });
      });
    }
  }
  return out;
}

/** The closest spelling of one person to the needle, or `undefined` when none is inside its budget. */
function closestSpelling({
  person,
  needle,
}: {
  person: MentionPerson;
  needle: string;
}): { field: NearField; value: string; distance: number } | undefined {
  let best: { field: NearField; value: string; distance: number } | undefined = undefined;
  for (const spelling of spellingsOf({ person })) {
    const budget = nearEditBudget({ length: Math.max(needle.length, spelling.value.length) });
    if (budget === 0 || Math.abs(needle.length - spelling.value.length) > budget) {
      continue;
    }
    const distance = levenshteinDistance({ left: needle, right: spelling.value });
    if (distance === 0 || distance > budget) {
      continue;
    }
    if (best === undefined || distance < best.distance) {
      best = { distance, field: spelling.field, value: spelling.value };
    }
  }
  return best;
}

/** Colleagues before outsiders, then closest first, then a stable key order. */
function nearOrder({ left, right }: { left: NearMatch; right: NearMatch }): number {
  const orgRank = ({ match }: { match: NearMatch }): number => (match.person.orgStatus === "org" ? 0 : 1);
  const byOrg = orgRank({ match: left }) - orgRank({ match: right });
  if (byOrg !== 0) {
    return byOrg;
  }
  const byDistance = left.distance - right.distance;
  if (byDistance !== 0) {
    return byDistance;
  }
  return left.person.key.localeCompare(right.person.key);
}

/**
 * Who in the member index is spelled near a token, for a token the exact ladder did not match. Pure — no
 * corpus read, no derive, no network.
 *
 * @param people the folded, org-classified people ({@link ./mentionResolver.mentionPeople})
 * @param token the raw token as the caller wrote it
 * @param limit how many to hand back at most; defaults to {@link NEAR_MATCH_LIMIT}
 * @returns the near matches, colleagues first and closest first — never a resolution, and empty when the
 *   token is spelled near nothing, which is the one case where an absence is worth stating plainly
 */
export function nearMentions({
  people,
  token,
  limit = NEAR_MATCH_LIMIT,
}: {
  people: readonly MentionPerson[];
  token: string;
  limit?: number;
}): readonly NearMatch[] {
  // Both normalisers, in that order: `normaliseHandle` strips the `@` a caller may have typed, and
  // `normaliseName` collapses the internal whitespace it leaves alone — so "Tobyn  Barten" costs the budget
  // its two substitutions rather than two substitutions plus a stray space.
  const needle = normaliseName({ name: normaliseHandle({ handle: token }) });
  if (needle.length === 0) {
    return [];
  }
  const matches: NearMatch[] = [];
  for (const person of people) {
    if (person.bot) {
      continue;
    }
    const closest = closestSpelling({ needle, person });
    if (closest !== undefined) {
      matches.push({ distance: closest.distance, field: closest.field, person, value: closest.value });
    }
  }
  return matches.toSorted((left, right) => nearOrder({ left, right })).slice(0, Math.max(0, limit));
}
