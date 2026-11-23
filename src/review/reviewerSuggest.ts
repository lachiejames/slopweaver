/**
 * A suggested reviewer for a pull request nobody is usefully on the hook for — derived from who GitHub names
 * as its code owners and who the owner has asked before, never from a guess.
 *
 * ## Three tiers, strongest first
 *
 * 1. `named-code-owner` — a PERSON the row is still `blockedOn`, resolved to a Slack id through the
 *    document's own `logins`. This is ownership, and the basis says so. `blockedOn` already drops a leftover
 *    request to a team's delegate once every rule is approved (`./requiredCodeowners.ts`), so a chase never
 *    names one as "the last codeowner tick".
 * 2. `team-history` — people the owner asked on EARLIER pull requests owned by the same `@org/team`.
 * 3. `repo-history` — people the owner asked on earlier pull requests in the same repository.
 *
 * Tiers two and three are what the owner DID, which is not who OWNS the change, so their basis sentence always ends
 * "history, not ownership" — a suggestion read as ownership is the failure this wording exists to prevent.
 *
 * ## Who is never suggested
 *
 * The owner and the owner's bot, the pull request's own author, a Slack user group (a group is an audience, never a
 * reviewer), anybody the owner declined for THIS pull request, and — on a chase that is due — the very person who
 * went silent, because suggesting the same name again is not a suggestion. Every one of them is left out under
 * EVERY Slack id the reading joined to the same person, since one person can carry two and an ask, a decline
 * or a code-owner join may each have used either; for the same reason one person is offered at most once.
 * The author is known only through that join, so when the reading could not join the author's login to
 * Slack at all the two history tiers are withheld — any id in them could be the author — and only a named
 * code owner is offered.
 *
 * Within a tier: more earlier pull requests first, then the most recent, then the id, so the order is total.
 * At most two alternatives travel with the primary.
 *
 * Pure.
 */
import { prKeyOfRow, type ReviewHook } from "./reviewerHook.js";
import type { ReviewerReadingRow } from "./reviewerReading.js";
import { codeOwnerTeamsOf, type ReviewerAskedRow, type ReviewerPickRow } from "./reviewerRegister.js";
import { joinSamePerson } from "./reviewRoster.js";

/** Which evidence a suggestion rests on. */
type SuggestionTier = "named-code-owner" | "team-history" | "repo-history";

/** One suggested reviewer and why. */
interface ReviewerSuggestion {
  /** The Slack member id. */
  readonly reviewer: string;
  readonly tier: SuggestionTier;
  /** How many EARLIER pull requests the owner asked them on, under this tier's scope. */
  readonly earlierPrs: number;
  /** When the owner last asked them, under this tier's scope; `undefined` for a code owner never asked. */
  readonly lastAskedIso: string | undefined;
  /** One sentence a reader can check. */
  readonly basis: string;
}

/** The suggestion for one pull request. */
export interface ReviewerSuggestionSet {
  readonly primary: ReviewerSuggestion;
  readonly alternatives: readonly ReviewerSuggestion[];
}

/** How many alternatives travel with the primary. */
const MAX_ALTERNATIVES = 2;

/** A Slack PERSON — a group (`S…`) is never suggested. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/;

/** One candidate's tally under one scope. */
interface Tally {
  readonly prs: Set<string>;
  lastIso: string | undefined;
}

/**
 * Whether this row's hook is one a suggestion answers: nobody usefully on the hook, or a chase that is due.
 *
 * @returns true when the page should offer a reviewer
 */
export function wantsSuggestion({ hook }: { hook: ReviewHook }): boolean {
  if (hook.kind === "nobody-asked" || hook.kind === "unknown") {
    return true;
  }
  return hook.kind === "asked" && hook.bump?.kind === "due";
}

/**
 * Every Slack id of the same person as each id either source knows: the roster, read when the list is made, and
 * the reading's own login joins, which is all a reading carries when the roster is absent.
 *
 * @param roster Slack id → every id of the same person, from the roster
 * @param logins lower-cased GitHub login → the Slack id that addresses that person
 * @param slackIdsForLogin lower-cased GitHub login → every Slack id the reading joined to that person
 * @returns Slack id → every id of the same person; an id absent here is its own person
 */
function samePersonOf({
  roster,
  logins,
  slackIdsForLogin,
}: {
  roster: ReadonlyMap<string, readonly string[]>;
  logins: ReadonlyMap<string, string>;
  slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
}): ReadonlyMap<string, readonly string[]> {
  const out = new Map(roster);
  for (const login of new Set([...logins.keys(), ...slackIdsForLogin.keys()])) {
    joinSamePerson({
      ids: idsOfLogin({ login, logins, slackIdsForLogin }),
      into: out,
    });
  }
  return out;
}

/**
 * Every Slack id the reading joined to one lower-cased GitHub login: the one it addresses them by, then the rest.
 *
 * @returns the ids, empty when the login has none
 */
function idsOfLogin({
  login,
  logins,
  slackIdsForLogin,
}: {
  login: string;
  logins: ReadonlyMap<string, string>;
  slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const ids: string[] = [];
  const addressed = logins.get(login);
  if (addressed !== undefined) {
    ids.push(addressed);
  }
  const every = slackIdsForLogin.get(login);
  if (every !== undefined) {
    ids.push(...every);
  }
  return ids;
}

/**
 * Tally who the owner asked, per Slack id, over the asks `inScope` admits.
 *
 * @returns the tallies
 */
function tallyOver({
  asks,
  inScope,
}: {
  asks: readonly ReviewerAskedRow[];
  inScope: (ask: ReviewerAskedRow) => boolean;
}): ReadonlyMap<string, Tally> {
  const out = new Map<string, Tally>();
  for (const ask of asks.filter(inScope)) {
    for (const id of ask.recipients) {
      let tally = out.get(id);
      if (tally === undefined) {
        tally = { lastIso: undefined, prs: new Set() };
        out.set(id, tally);
      }
      tally.prs.add(ask.prKey);
      if (tally.lastIso === undefined || ask.atIso > tally.lastIso) {
        tally.lastIso = ask.atIso;
      }
    }
  }
  return out;
}

/**
 * The total order within one tier: more earlier pull requests, then more recent, then id.
 *
 * @returns a negative, zero or positive number, as `Array.prototype.sort` wants
 */
function byStrength({ a, b }: { a: ReviewerSuggestion; b: ReviewerSuggestion }): number {
  if (a.earlierPrs !== b.earlierPrs) {
    return b.earlierPrs - a.earlierPrs;
  }
  if (a.lastAskedIso !== b.lastAskedIso) {
    // Never asked sorts after any ask, as the oldest.
    if (a.lastAskedIso === undefined) {
      return 1;
    }
    if (b.lastAskedIso === undefined) {
      return -1;
    }
    return a.lastAskedIso < b.lastAskedIso ? 1 : -1;
  }
  return a.reviewer < b.reviewer ? -1 : 1;
}

/**
 * The count phrase for a basis sentence.
 *
 * @returns `1 earlier pull request`, `3 earlier pull requests`
 */
function earlierPhrase({ count }: { count: number }): string {
  if (count === 1) {
    return "1 earlier pull request";
  }
  return `${String(count)} earlier pull requests`;
}

/**
 * Every Slack id of the person one id belongs to, or that id alone when the roster knows no other.
 *
 * @param people Slack id → every id of the same person
 * @returns the ids
 */
function idsOfPerson({
  id,
  people,
}: {
  id: string;
  people: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const person = people.get(id);
  if (person === undefined) {
    return [id];
  }
  return person;
}

/**
 * Every Slack id the suggestion must never offer, each widened to every id of the same person: the owner and
 * the owner's bot, the author, anyone declined on this pull request, and — when a chase is due — the person who went
 * silent.
 *
 * @param people Slack id → every id of the same person
 * @returns the ids, and whether the author could be joined to Slack at all
 */
function leftOutOf({
  row,
  hook,
  picks,
  logins,
  slackIdsForLogin,
  people,
  excluded,
}: {
  row: ReviewerReadingRow;
  hook: ReviewHook;
  picks: readonly ReviewerPickRow[];
  logins: ReadonlyMap<string, string>;
  slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
  people: ReadonlyMap<string, readonly string[]>;
  excluded: ReadonlySet<string>;
}): { never: ReadonlySet<string>; authorKnown: boolean } {
  const prKey = prKeyOfRow({ row });
  const authorIds = idsOfLogin({ login: row.authorLogin.toLowerCase(), logins, slackIdsForLogin });
  const declined = picks
    .filter((pick) => pick.prKey === prKey && pick.verdict === "decline")
    .map((pick) => pick.reviewer);
  const silent = hook.kind === "asked" && hook.bump?.kind === "due" ? [hook.primary] : [];
  const never = new Set<string>();
  for (const id of [...excluded, ...authorIds, ...declined, ...silent]) {
    for (const each of idsOfPerson({ id, people })) {
      never.add(each);
    }
  }
  // An author the reading could not join to Slack could be ANY id in the history tallies, so only the
  // named-code-owner tier survives: GitHub never names a pull request's author as its pending code owner.
  return { authorKnown: authorIds.length > 0, never };
}

/**
 * Rank the tiers into one list, strongest tier first, each person offered once under whichever id came first.
 *
 * @param tiers the candidates, one list per tier in strength order
 * @param never ids the suggestion must never offer
 * @param people Slack id → every id of the same person
 * @returns the ranked suggestions
 */
function rankTiers({
  tiers,
  never,
  people,
}: {
  tiers: readonly (readonly ReviewerSuggestion[])[];
  never: ReadonlySet<string>;
  people: ReadonlyMap<string, readonly string[]>;
}): readonly ReviewerSuggestion[] {
  const chosen = new Set<string>();
  const ranked: ReviewerSuggestion[] = [];
  for (const suggestion of tiers.flatMap((tier) => tier.toSorted((a, b) => byStrength({ a, b })))) {
    const offerable =
      !chosen.has(suggestion.reviewer) && !never.has(suggestion.reviewer) && MEMBER_ID.test(suggestion.reviewer);
    if (offerable) {
      for (const each of idsOfPerson({ id: suggestion.reviewer, people })) {
        chosen.add(each);
      }
      ranked.push(suggestion);
    }
  }
  return ranked;
}

/**
 * The strongest tier: every person GitHub names as a code owner on the row, joined to Slack.
 *
 * @param everyEarlier who the owner asked on every earlier pull request, for the basis sentence's count
 * @returns the candidates
 */
function namedOwnerTier({
  row,
  logins,
  everyEarlier,
}: {
  row: ReviewerReadingRow;
  logins: ReadonlyMap<string, string>;
  everyEarlier: ReadonlyMap<string, Tally>;
}): readonly ReviewerSuggestion[] {
  const ownerIds = row.blockedOn
    .filter((token) => !token.includes("/"))
    .flatMap((token) => {
      const id = logins.get(token.replace(/^@/, "").toLowerCase());
      return id === undefined ? [] : [id];
    });
  return ownerIds.map((id): ReviewerSuggestion => {
    const tally = everyEarlier.get(id);
    let basis = "GitHub names them as a code owner on this pull request";
    if (tally !== undefined) {
      basis = `${basis}, and you asked them on ${earlierPhrase({ count: tally.prs.size })}`;
    }
    return {
      basis,
      earlierPrs: tally === undefined ? 0 : tally.prs.size,
      lastAskedIso: tally?.lastIso,
      reviewer: id,
      tier: "named-code-owner",
    };
  });
}

/**
 * A history tier: everyone a tally counts, each with the sentence that says it is history, not ownership.
 *
 * @param where the scope phrase the basis ends on, `owned by @org/team` or `in owner/repo`
 * @returns the candidates
 */
function historyTier({
  tally,
  where,
  tier,
}: {
  tally: ReadonlyMap<string, Tally>;
  where: string;
  tier: SuggestionTier;
}): readonly ReviewerSuggestion[] {
  return [...tally].map(([id, each]): ReviewerSuggestion => ({
    basis: `you asked them on ${earlierPhrase({ count: each.prs.size })} ${where} — history, not ownership`,
    earlierPrs: each.prs.size,
    lastAskedIso: each.lastIso,
    reviewer: id,
    tier,
  }));
}

/**
 * Suggest a reviewer for one row.
 *
 * @param row the row as the last reading carried it
 * @param hook the row's hook — a suggestion is offered only when {@link wantsSuggestion} says so
 * @param asks every `asked` row the register holds
 * @param picks every `pick` row the register holds
 * @param logins lower-cased GitHub login → Slack id, as the reading resolved them
 * @param slackIdsForLogin lower-cased GitHub login → every Slack id the reading joined to that person
 * @param samePerson Slack id → every id of the same person, from the roster as the list is made — how a
 *   reviewer who is nobody's author or code owner is still left out under every id they carry
 * @param excluded Slack ids never suggested whatever the evidence — the owner and the owner's bot
 * @returns the suggestion, or `undefined` when none is wanted or no evidence names anybody
 */
export function suggestReviewer({
  row,
  hook,
  asks,
  picks,
  logins,
  slackIdsForLogin,
  samePerson,
  excluded,
}: {
  row: ReviewerReadingRow;
  hook: ReviewHook;
  asks: readonly ReviewerAskedRow[];
  picks: readonly ReviewerPickRow[];
  logins: ReadonlyMap<string, string>;
  slackIdsForLogin: ReadonlyMap<string, readonly string[]>;
  samePerson: ReadonlyMap<string, readonly string[]>;
  excluded: ReadonlySet<string>;
}): ReviewerSuggestionSet | undefined {
  if (!wantsSuggestion({ hook })) {
    return undefined;
  }
  const prKey = prKeyOfRow({ row });
  const people = samePersonOf({ logins, roster: samePerson, slackIdsForLogin });
  const { never, authorKnown } = leftOutOf({ excluded, hook, logins, people, picks, row, slackIdsForLogin });
  const earlier = asks.filter((ask) => ask.prKey !== prKey);
  const teams = codeOwnerTeamsOf({ blockedOn: row.blockedOn });
  const tiers = [namedOwnerTier({ everyEarlier: tallyOver({ asks: earlier, inScope: () => true }), logins, row })];
  if (authorKnown) {
    const teamTally = tallyOver({
      asks: earlier,
      inScope: (ask) => ask.codeOwnerTeams.some((team) => teams.includes(team)),
    });
    const repoTally = tallyOver({ asks: earlier, inScope: (ask) => ask.repoSlug === row.repoSlug });
    tiers.push(
      historyTier({ tally: teamTally, tier: "team-history", where: `owned by ${teams.join(", ")}` }),
      historyTier({ tally: repoTally, tier: "repo-history", where: `in ${row.repoSlug}` }),
    );
  }
  const [primary, ...rest] = rankTiers({ never, people, tiers });
  if (primary === undefined) {
    return undefined;
  }
  return { alternatives: rest.slice(0, MAX_ALTERNATIVES), primary };
}
