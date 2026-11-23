/**
 * The Slack reader's facts about each thread the owner spoke in, turned into `slack awaiting`'s candidates — the owner's own
 * messages with what each asks, and every other person in the thread named off the members index.
 *
 * Kept apart from `./slackRead.ts` so that file stays the two-pass scan and nothing else. Pure given its inputs:
 * the members index and the bot ids are read once by the reader and handed in.
 */

import type { SlackAwaitingCandidate, SlackOwnerWord, SlackThreadPerson } from "../../../sessionStart/slackAwaiting.js";
import { replyAskOf } from "../../../sessionStart/slackAwaiting.js";
import type { MemberFacts } from "./slackPeople.js";
import { authorIsHuman, displayNameOf, isTaggablePerson } from "./slackPeople.js";
import type { SlackRow } from "./slackRow.js";
import type { ThreadFacts } from "./slackThreadFacts.js";
import { orderOf } from "./slackThreadFacts.js";

/** How much of one of the owner's messages a row quotes — the same budget the other Slack rows use. */
const QUOTE_CHARS = 140;

/**
 * One of the owner's messages as the selection reads it.
 *
 * @param row the parsed message
 * @param ownerId the owner's own Slack id
 * @param members the members index, which says whether a reactor is a person
 * @param selfIds Slopweaver's own bot ids
 * @returns the word, its ask read off the authored text, and its tags and reactions narrowed to people
 */
function ownerWordOf({
  row,
  ownerId,
  members,
  selfIds,
}: {
  row: SlackRow;
  ownerId: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): SlackOwnerWord {
  const ask = replyAskOf({ authoredText: row.authoredText, ownerId, selfIds });
  return {
    // A tag of a bot asks no PERSON anything, and a bot's reply never answers, so an "@cursor fix this" would
    // wait forever.
    ask: { ...ask, taggedIds: ask.taggedIds.filter((id) => authorIsHuman({ author: id, members, selfIds })) },
    ownTs: row.ownTs,
    permalink: row.url,
    pullRequests: row.pullRequests,
    quote: row.text.replaceAll("\n", " ").trim().slice(0, QUOTE_CHARS),
    reactedBy: row.answeringReactorIds.filter(
      (id) => id !== ownerId && authorIsHuman({ author: id, members, selfIds }),
    ),
    tsIso: row.tsIso,
  };
}

/**
 * Everybody in one thread but the owner: every other author, then every person the owner's words tagged who never spoke there.
 *
 * @param thread the thread's facts
 * @param ownerWords the owner's words in it, already read, whose tags name the people who never spoke
 * @param ownerId the owner's own Slack id
 * @param members the members index
 * @param selfIds Slopweaver's own bot ids
 * @returns the people, authors first
 */
function peopleOf({
  thread,
  ownerWords,
  ownerId,
  members,
  selfIds,
}: {
  thread: ThreadFacts;
  ownerWords: readonly SlackOwnerWord[];
  ownerId: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): SlackThreadPerson[] {
  const personOf = ({ id }: { id: string }): SlackThreadPerson => ({
    id,
    isHuman: authorIsHuman({ author: id, members, selfIds }),
    name: displayNameOf({ author: id, members }),
    taggable: isTaggablePerson({ id, members, ownerId, selfIds }),
  });
  const authors = [...thread.authors]
    .filter(([author]) => author !== ownerId)
    .map(([author, row]) => ({ ...personOf({ id: author }), lastIso: row.tsIso, lastOwnTs: row.ownTs }));
  const neverSpoke = [...new Set(ownerWords.flatMap((word) => word.ask.taggedIds))]
    .filter((id) => !thread.authors.has(id))
    .map((id) => personOf({ id }));
  return [...authors, ...neverSpoke];
}

/**
 * Every thread the owner spoke in, as a candidate for `slack awaiting`.
 *
 * `people` carries every author but the owner, then every person the owner's messages tagged who never spoke in the
 * thread. A thread whose key is not `channel:ts` cannot occur — `threadKeyOf` built every key — and one that
 * did is skipped rather than given an invented channel.
 *
 * @param facts each followed thread's facts, from pass two
 * @param ownerId the owner's own Slack id
 * @param members the members index
 * @param selfIds Slopweaver's own bot ids
 * @returns one candidate per followed thread, in the map's order
 */
export function awaitingCandidatesOf({
  facts,
  ownerId,
  members,
  selfIds,
}: {
  facts: ReadonlyMap<string, ThreadFacts>;
  ownerId: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): readonly SlackAwaitingCandidate[] {
  const candidates: SlackAwaitingCandidate[] = [];
  for (const [key, thread] of facts) {
    const [channelId, threadTs] = key.split(":");
    if (channelId === undefined || threadTs === undefined) {
      continue;
    }
    const ownerWords = [...thread.ownerWords.values()]
      .toSorted((a, b) => orderOf({ a, b }))
      .map((row) => ownerWordOf({ members, ownerId, row, selfIds }));
    const channelName = thread.latest.channelName;
    candidates.push({
      channelId,
      hasReplies: thread.hasReplies,
      ownerWords,
      people: peopleOf({ members, ownerId, ownerWords, selfIds, thread }),
      threadTs,
      ...(channelName === undefined ? {} : { channelName }),
    });
  }
  return candidates;
}
