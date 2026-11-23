/**
 * Resolving everyone an outbound Slack message addresses — people through every identity layer, user groups
 * through the structure index — for every caller that sends: the Slack verbs, and a bot turn rendering its
 * answer's mentions and asker names.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { loadProfile } from "../../profileStore.js";
import { lookupMentionsWithHeardAs } from "../../silver/heardAs.js";
import { type IdentityRosterPort, type IdentityRosterSnapshot } from "../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../silver/identityRosterErrors.js";
import { memberDirectory } from "../../silver/memberDirectory.js";
import { rosterForSend } from "../../silver/rosterForSend.js";
import { readSlackUsergroups } from "../../silver/slackUsergroups.js";
import { addressableGroups } from "./groupIndex.js";
import { type MentionResolution, resolveMentionKeys } from "./mentionIndex.js";

/**
 * The roster a send naming no person resolves over when the store could not answer. Nothing it holds could change
 * that send's outcome; its null revision reaches only the derived roster's freshness verdict, which refuses a send
 * solely through a person it names, and reads as unwitnessed rather than as a row.
 */
const UNREAD: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };

/**
 * Resolve everyone an outbound message addresses — people through every identity layer, user GROUPS through
 * the structure index.
 *
 * The layers, and why there are several: `slopweaver derive` writes the whole team into
 * `corpus/silver/index/identities.json`, while a fresh install's human roster in the store is empty. Reading
 * only the second — which is what once shipped — resolved NOTHING after a correct onboarding.
 * So the derived roster supplies the population and the human roster overrides it.
 *
 * The MEMBER index (`../../silver/mentionResolver.ts`) then sits between them, and it is the layer that
 * makes this function work at all on a real corpus: `derive` refuses past the heap ceiling, so the derived
 * roster freezes and its absences are indistinguishable from a person not existing. Member bronze is each
 * provider's own member list, so it needs no derive, and it is the only layer that may match a bare first
 * name — see that module for the tier ladder and the domain check that make that safe. A key it names nobody
 * for may still follow a heard-as pin the human roster declares (`../../silver/heardAs.ts`) — "Smitty" to
 * John Smith — and the target is answered by the same member ladder.
 *
 * EXACT MATCH ONLY over keys a Slack identity owns (see `mentionIndex.ts`), plus the member layer's tiered
 * NAME match, which resolves only when exactly one live colleague answers and REFUSES — naming them — when
 * more than one does. A person who resolves nowhere is simply absent from the returned map, and the caller
 * turns that into a hard error before any send. Never a nearest guess: mentioning the wrong colleague is
 * worse than refusing.
 *
 * A THIRD layer sits above both rosters: the bot's own declared identity (`profile.json`'s
 * `slackBot.selfUserIds`, dedicated to this and NOT `botUserIds` — see `mentionIndex.ts`). The bot can never
 * earn a derived identity by authoring records — `ownerBot.ts` rewrites its own posts back to the human
 * owner before identity resolution ever sees them — so without this layer an `--as me` send could never tag
 * the bot itself, no matter how the corpus grew.
 *
 * A FOURTH index answers a different question entirely: `groups` are Slack USER GROUPS, read out of
 * `corpus/structures/slack.jsonl` by `../../silver/slackUsergroups.ts`, matched by
 * `../../silver/groupMention.ts` and then judged as ADDRESSES by `./groupIndex.ts`
 * — which refuses a disabled group, an empty one and a display-name match, all three of which that resolver
 * deliberately answers because its own caller is READING rather than sending. This function does both in one
 * step because a card addresses both in one message and a caller that forgot one would post an unrendered id;
 * it shares none of the layering above, because a group is not a person — there is no derived roster entry,
 * no held candidate and no human override for one, and `derive` has never carried a group at all.
 *
 * @param home the state home holding both rosters, the structure index and the profile
 * @param people the keys the artifact mentions
 * @param groups the user-group handles the artifact addresses
 * @param askedAtIso when this send was asked for, which the roster's freshness is judged against
 * @param conversationMembers the Slack ids in the conversation the message posts into, when the caller read them —
 *   a member there is addressable whatever the member index can say about their email
 * @param identityRoster the door the human roster is read through — the store's `identity-roster` row
 * @returns the resolutions, their origin layer, the group verdicts, and the roster state behind them; or the
 *   roster's typed refusal, because a store that cannot say who a handle names must stop the send rather than
 *   resolve against the layers it could still read
 */
export async function mentionsFromIdentity({
  home,
  people,
  groups,
  askedAtIso,
  conversationMembers,
  identityRoster,
}: {
  home: string;
  people: readonly string[];
  groups: readonly string[];
  askedAtIso: string;
  conversationMembers?: ReadonlySet<string> | undefined;
  identityRoster: IdentityRosterPort;
}): Promise<Result<MentionResolution, IdentityRosterError>> {
  // Read ONCE: the member leg follows its heard-as pins, the override layer reads its keys and the freshness
  // verdict witnesses its revision, and two reads could hand the three stages different rosters.
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    // A send naming no PERSON is one no roster can change — the test `rosterForSend`'s `affectsOutput` already
    // applies to `derive`, and a group never reads the human roster at all — so an outage cannot stop a message
    // that addresses nobody. One that names anybody stops: who the handle names is unknown.
    if (people.length === 0) {
      return ok(
        mentionsFromRosterSnapshot({ askedAtIso, conversationMembers, groups, home, people, snapshot: UNREAD }),
      );
    }
    return err(snapshot.error);
  }
  return ok(
    mentionsFromRosterSnapshot({ askedAtIso, conversationMembers, groups, home, people, snapshot: snapshot.value }),
  );
}

/**
 * {@link mentionsFromIdentity}'s resolution, over one roster snapshot the caller already read — for a SYNCHRONOUS
 * render path (a card's asker names) whose nearest async root read the port once and handed the snapshot down.
 *
 * @param home the state home holding the member index, the derived roster and the profile
 * @param people the keys the caller asks about
 * @param groups the user-group handles addressed
 * @param askedAtIso when the send was asked for, which the derived roster's freshness is judged against
 * @param conversationMembers the Slack ids already known to sit in the target conversation, when read
 * @param snapshot the store's identity roster, read once by the caller; overrides and the freshness revision
 *   both come off it
 * @returns the resolutions, their origin layer, the group verdicts and the roster state behind them
 */
export function mentionsFromRosterSnapshot({
  home,
  people,
  groups,
  askedAtIso,
  conversationMembers,
  snapshot,
}: {
  home: string;
  people: readonly string[];
  groups: readonly string[];
  askedAtIso: string;
  conversationMembers: ReadonlySet<string> | undefined;
  snapshot: IdentityRosterSnapshot;
}): MentionResolution {
  const directory = memberDirectory({ home });
  const overrides = snapshot.records;
  const memberLookups = lookupMentionsWithHeardAs({
    conversationMembers,
    keys: people,
    orgDomains: directory.orgDomains,
    records: overrides,
    rows: directory.rows,
    source: "slack",
  });
  // The member index goes FIRST, and what it settles decides whether `derive` runs at all. Only a key it
  // has nothing to say about can still be answered by the derived roster, so only such a key is worth
  // paying a just-in-time derive for — which on a corpus past the heap ceiling is a refusal that costs
  // minutes and changes nothing.
  const { roster, freshness } = rosterForSend({
    affectsOutput: people.some((person) => memberLookups.get(person)?.kind !== "resolved"),
    askedAtIso,
    home,
    identityRoster: snapshot,
  });
  return resolveMentionKeys({
    derived: roster,
    freshness,
    // Only READ the structure file when a group is actually addressed — the same "can this change the
    // outcome" test `rosterForSend` applies to `derive`, for a file that is megabytes rather than the whole
    // corpus but is still read on a path some callers take once per person.
    groupAddresses:
      groups.length === 0 ? new Map() : addressableGroups({ groups: readSlackUsergroups({ home }), keys: groups }),
    memberLookups,
    overrides,
    people,
    selfUserIds: loadProfile({ home })?.slackBot?.selfUserIds,
  });
}
