/**
 * WHAT A SLACK USER ID READS AS on a card the bot posts — the one read behind `./quotedQuestion.ts`.
 *
 * `./quotedQuestion.ts` is pure and rewrites the asker's markup into prose; this is the effectful half that
 * tells it whose id is whose. They are split because the rewrite has to be assertable with no filesystem,
 * and because the same rewrite runs on paths that have no state home at all.
 *
 * ## It goes through the door, and it is the SAME door
 *
 * `mentionsFromRosterSnapshot` (`../../outbound/slack/mentionWiring.ts`) is the resolution every outbound mention
 * already uses, over a roster snapshot the poster's builder read once from the store, so this stays
 * synchronous. A Slack native id is an addressable KEY by construction — the `native-id` tier in
 * `../../silver/mentionResolver.ts`. So this asks the identity layers the question they already answer
 * rather than reaching past them into member bronze, exactly as `./answerMentions.ts` does for the mentions
 * an answer actually writes. A just-in-time `derive` is only paid for when a key the member index could not
 * settle exists, so a call whose ids all resolve is a member-bronze read.
 *
 * ## Why this cannot fail
 *
 * There is no `Result` here and that is deliberate. An id the door does not know is not an error a caller
 * branches on: it is simply absent from the map, and `questionForPlainField` renders the id itself, which is
 * the honest answer its own header argues for. A union invented for a failure nobody handles is the ceremony
 * `.claude/rules/error-handling.md` § "When NOT to introduce a union" names.
 */
import { mentionsFromRosterSnapshot } from "../../outbound/slack/mentionWiring.js";
import type { IdentityRosterSnapshot } from "../../silver/identityRoster.js";
import type { MentionLookup } from "../../silver/mentionResolver.js";

/**
 * The names a set of already-performed lookups settles — the PURE half, so the reading rule is assertable
 * with no state home at all.
 *
 * Split out rather than inlined because the rule it carries is the interesting part and the read around it
 * is not: only a `resolved` lookup contributes a name. Every other arm — ambiguous, external, unverified,
 * no-account, unknown — is a person the door declined to bind, and writing one of their candidates onto a
 * card would put a name beside an id the identity layer refused to settle.
 *
 * @param slackIds the ids asked about, so the result is ordered by the question rather than by the map
 * @param lookups what the member index settled for each id
 * @returns one entry per id that RESOLVED; every other id is absent rather than guessed
 */
export function namesFromLookups({
  slackIds,
  lookups,
}: {
  slackIds: readonly string[];
  lookups: ReadonlyMap<string, MentionLookup>;
}): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  slackIds.forEach((slackId) => {
    const lookup = lookups.get(slackId);
    if (lookup?.kind === "resolved") {
      names[slackId] = lookup.match.person.displayName;
    }
  });
  return names;
}

/**
 * The display name for each Slack user id the identity layers can place.
 *
 * @param slackIds the ids to resolve — `./quotedQuestion.ts`'s `slackUserIdsIn` produces exactly this list
 * @param home the state home holding the identity layers
 * @param askedAtIso when the send these names are for was asked for, which the roster is judged against
 * @param identityRoster the store's identity roster, read ONCE by the nearest async root (the poster's builder)
 * @returns one entry per id that RESOLVED; an id the door could not place is absent rather than guessed
 */
export function askerDisplayNames({
  slackIds,
  home,
  askedAtIso,
  identityRoster,
}: {
  slackIds: readonly string[];
  home: string;
  askedAtIso: string;
  identityRoster: IdentityRosterSnapshot;
}): Readonly<Record<string, string>> {
  if (slackIds.length === 0) {
    return {};
  }
  const resolution = mentionsFromRosterSnapshot({
    askedAtIso,
    conversationMembers: undefined,
    groups: [],
    home,
    people: slackIds,
    snapshot: identityRoster,
  });
  return namesFromLookups({ lookups: resolution.memberLookups, slackIds });
}
