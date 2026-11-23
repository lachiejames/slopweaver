/**
 * Who a `--person` names, resolved against the store's own people rather than against a string column.
 *
 * ## Why this is a resolution step and not a `WHERE display_name = $1`
 *
 * The structured half of what replaces semantic search is querying everything from one person across
 * platforms. A person is the one axis that
 * genuinely spans platforms — a Slack member id, a Linear UUID and a GitHub login are the same human —
 * and `content.author_id` already points at the `person` row those ids resolve to. So the filter is over
 * PEOPLE, and naming one is a lookup with three ways to succeed and one way to fail loudly.
 *
 * ## The failure mode this module exists to refuse
 *
 * A person filter that matches nobody returns zero rows, and zero rows reads exactly like "this person
 * said nothing across every platform" — a confident, wrong answer with no way to tell it apart from a
 * misspelled name. That is the same defect `query.ts` refuses for a misspelled `--source`. So an
 * unmatched name is a REFUSAL carrying the closest names the store actually holds, never an empty page.
 *
 * ## One normalisation, not a second one written in SQL
 *
 * Matching happens in TypeScript over the whole `person` table, through the SAME
 * {@link ./identity/matching.normalizeName} and {@link ./identity/matching.normalizeEmail} the reconciler
 * keys people with. Writing the comparison as SQL would be a second definition of "the same person", and
 * two definitions of one identity drift — measured on this workstream as five review rounds of which four
 * were key drift. The table is small enough for that to be free: a directory runs to hundreds of users and
 * the member pull's own ceiling to a couple of thousand (`docs/store/owner-registers-and-roles.md`), so this is one indexed read of a couple of
 * thousand rows.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { normalizeEmail, normalizeName } from "./identity/matching.js";
import type { PersonCandidate, PersonMatch, PersonMatchWay } from "./personMatch.js";
import { personTable } from "./schema/person.js";

/**
 * How many near-miss names an unmatched `--person` refusal offers back.
 *
 * @internal
 */
export const PERSON_SUGGESTION_LIMIT = 8;

/**
 * Which sources a person carries an id on, sorted.
 *
 * @param person the candidate
 * @returns each source name once, in sort order
 */
function sourcesOf({ person }: { person: PersonCandidate }): readonly string[] {
  const sources: string[] = [];
  if (person.githubLogin !== null || person.githubId !== null) {
    sources.push("github");
  }
  if (person.linearUserId !== null) {
    sources.push("linear");
  }
  if (person.notionUserId !== null) {
    sources.push("notion");
  }
  if (person.slackUserId !== null) {
    sources.push("slack");
  }
  return sources;
}

/**
 * The way a name reaches one person, or `null` when it does not.
 *
 * The three ways are tried in order of how much they claim. A display name is the store's own label for
 * the human; a handle is the one platform id a person can be addressed by in prose (their GitHub login);
 * an address is issued by an authority outside us, which is why it is the person's key and why it is
 * accepted here whole rather than as a fragment.
 *
 * @param person the candidate being tested
 * @param name the normalised name the caller typed
 * @param email the normalised address form of what the caller typed
 * @returns which way matched, or `null`
 */
function wayFor({
  person,
  name,
  email,
}: {
  person: PersonCandidate;
  name: string;
  email: string;
}): PersonMatchWay | null {
  if (normalizeName({ name: person.displayName }) === name) {
    return "display-name";
  }
  if (person.githubLogin !== null && normalizeName({ name: person.githubLogin }) === name) {
    return "handle";
  }
  if (normalizeEmail({ email: person.email }) === email) {
    return "email";
  }
  return null;
}

/**
 * Every person a typed name reaches. Pure.
 *
 * More than one match is a real answer rather than an error: two people can genuinely share a display
 * name, and collapsing them to the first would silently drop half of what the caller asked for. The
 * caller reports how many were matched, so an ambiguous name is visible instead of resolved by luck.
 *
 * @param people every person the store holds
 * @param name the name, handle or address the caller typed
 * @returns one entry per matched person, in the order they were given
 */
export function matchPeople({
  people,
  name,
}: {
  people: readonly PersonCandidate[];
  name: string;
}): readonly PersonMatch[] {
  const wantedName = normalizeName({ name });
  const wantedEmail = normalizeEmail({ email: name });
  const matched: PersonMatch[] = [];
  for (const person of people) {
    const way = wayFor({ email: wantedEmail, name: wantedName, person });
    if (way !== null) {
      matched.push({ person, sources: sourcesOf({ person }), way });
    }
  }
  return matched;
}

/**
 * The names closest to one the store does not hold, so a refusal is actionable. Pure.
 *
 * A substring test rather than an edit distance, deliberately: the name a caller types wrong is almost
 * always a partial one — a first name, a surname, a handle without its team prefix — and a substring
 * finds those where a distance threshold tuned for typos does not.
 *
 * @param people every person the store holds
 * @param name what the caller typed
 * @param limit how many names to offer
 * @returns the display names that contain, or are contained by, the typed name
 */
export function suggestPeople({
  people,
  name,
  limit = PERSON_SUGGESTION_LIMIT,
}: {
  people: readonly PersonCandidate[];
  name: string;
  limit?: number;
}): readonly string[] {
  const wanted = normalizeName({ name });
  if (wanted.length === 0) {
    return [];
  }
  const near: string[] = [];
  for (const person of people) {
    const candidate = normalizeName({ name: person.displayName });
    if (candidate.includes(wanted) || wanted.includes(candidate)) {
      near.push(person.displayName);
    }
  }
  return near.toSorted().slice(0, limit);
}

/**
 * Read every person the store holds, with the columns the matcher compares against.
 *
 * @param client the open store
 * @returns every person, or the typed database failure
 */
async function loadPeople({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly PersonCandidate[], StoreError>> {
  try {
    const rows = await client.db
      .select({
        displayName: personTable.displayName,
        email: personTable.email,
        githubId: personTable.githubId,
        githubLogin: personTable.githubLogin,
        id: personTable.id,
        linearUserId: personTable.linearUserId,
        notionUserId: personTable.notionUserId,
        slackUserId: personTable.slackUserId,
      })
      .from(personTable);
    return ok(rows);
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store person read" }));
  }
}

/**
 * Resolve a typed name to the people it reaches, refusing with near misses when it reaches nobody.
 *
 * @param client the open store
 * @param name the name, handle or address the caller typed
 * @returns the matches, or the refusal naming what the store does hold
 */
export async function resolvePeople({
  client,
  name,
}: {
  client: StoreClient;
  name: string;
}): Promise<Result<readonly PersonMatch[], StoreError>> {
  const people = await loadPeople({ client });
  if (people.isErr()) {
    return err(people.error);
  }
  const matched = matchPeople({ name, people: people.value });
  if (matched.length > 0) {
    return ok(matched);
  }
  return err(
    StoreErrors.personUnknown({
      known: people.value.length,
      name,
      suggestions: suggestPeople({ name, people: people.value }),
    }),
  );
}
