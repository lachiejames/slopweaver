/**
 * The private-word proposals a Queue card names by id. These are the exact `pp-` tokens `private-terms add`, `narrow`
 * and `remove` mint, matched whole, so finding them is a lookup and never a guess at prose. The same parse reads the
 * route's query, which carries ids and nothing else.
 *
 * Pure: texts in, ids out; a query in, ids or a refusal out.
 */

/** The most proposals one card asks for at once. A card naming more draws the first this many. */
export const PRIVATE_TERM_PROPOSAL_MAX_IDS = 16;

/** One proposal id exactly as minted: `pp-` and twelve lowercase hex digits. */
const PROPOSAL_ID = /^pp-[0-9a-f]{12}$/u;

/** The same id inside prose, whole: no letter, digit or hyphen either side. */
const PROPOSAL_ID_IN_TEXT = /(?<![A-Za-z0-9-])pp-[0-9a-f]{12}(?![A-Za-z0-9-])/gu;

/** The one query parameter the route reads, repeated once per id. */
export const PRIVATE_TERM_PROPOSAL_PARAM = "id";

/**
 * Every proposal id the texts name, first seen first, each once, at most {@link PRIVATE_TERM_PROPOSAL_MAX_IDS}.
 *
 * @param texts the card's fields in the order their ids should be listed; an absent field is skipped
 * @returns the ids
 */
export function privateTermProposalIdsIn({ texts }: { texts: readonly (string | undefined)[] }): readonly string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (text === undefined) {
      continue;
    }
    for (const match of text.matchAll(PROPOSAL_ID_IN_TEXT)) {
      if (!out.includes(match[0]) && out.length < PRIVATE_TERM_PROPOSAL_MAX_IDS) {
        out.push(match[0]);
      }
    }
  }
  return out;
}

/**
 * Read the route's query: one or more `id` parameters, each a whole proposal id, none repeated, no more than the
 * card can ask for, and no other parameter at all.
 *
 * @param params the request's search parameters
 * @returns the ids in the asked order, or `undefined` for any query the card never sends
 */
export function privateTermProposalRequest({ params }: { params: URLSearchParams }): readonly string[] | undefined {
  const ids: string[] = [];
  for (const [name, value] of params) {
    if (name !== PRIVATE_TERM_PROPOSAL_PARAM || !PROPOSAL_ID.test(value) || ids.includes(value)) {
      return undefined;
    }
    ids.push(value);
  }
  if (ids.length === 0 || ids.length > PRIVATE_TERM_PROPOSAL_MAX_IDS) {
    return undefined;
  }
  return ids;
}

/**
 * The route's query for a list of ids, as the card sends it.
 *
 * @param ids the proposal ids, in order
 * @returns the query string, without its leading `?`
 */
export function privateTermProposalQuery({ ids }: { ids: readonly string[] }): string {
  const params = new URLSearchParams();
  for (const id of ids) {
    params.append(PRIVATE_TERM_PROPOSAL_PARAM, id);
  }
  return params.toString();
}
