import { describe, expect, it } from "vitest";

import { awaitingCandidatesOf } from "../../../cli/commands/sessionStart/slackAwaitingRead.js";
import type { MemberFacts } from "../../../cli/commands/sessionStart/slackPeople.js";
import type { SlackRow } from "../../../cli/commands/sessionStart/slackRow.js";
import {
  joinBroadcastReactors,
  ownerStartedThread,
  recordThreadLine,
  recordThreadMessage,
  type ThreadFacts,
} from "../../../cli/commands/sessionStart/slackThreadFacts.js";
import { epochSecondsToIso } from "../../../lib/date.js";

const OWNER = "U0SYNOWNER1234";
const ALICE = "U0SYNALICE1234";
const BOB = "U0SYNBOB123456";
const APP = "U0SYNAPP123456";
const KEY = "C0SYNCHANNEL1:1790300000.000100";

const members = new Map<string, MemberFacts>([
  [ALICE, { active: true, bot: false, name: "Alice" }],
  [BOB, { active: true, bot: false, name: "Bob" }],
  [APP, { active: true, bot: true, name: "An Alert App" }],
]);

/**
 * One parsed message in the thread under {@link KEY}.
 *
 * @param seconds its own Slack `ts` seconds, which also set its instant
 * @param root true for the thread's root message rather than a reply
 * @returns the row
 */
function row({
  author,
  seconds,
  text = "hello",
  root = false,
  answeringReactorIds = [],
}: {
  author: string;
  seconds: number;
  text?: string;
  root?: boolean;
  answeringReactorIds?: readonly string[];
}): SlackRow {
  const ts = `${String(seconds)}.000100`;
  return {
    answeringReactorIds,
    author,
    authoredText: text,
    channelName: "a-channel",
    ownTs: Number(ts),
    pullRequests: [],
    sourceId: root ? `C0SYNCHANNEL1:${ts}` : `${KEY}:reply:${ts}`,
    text,
    tsIso: epochSecondsToIso({ seconds })!,
    url: `https://example.slack.com/archives/C0SYNCHANNEL1/p${ts.replace(".", "")}`,
  };
}

/**
 * Fold every row into a fresh map, in the order given.
 *
 * @param rows the thread's messages
 * @returns the map
 */
function fold({ rows }: { rows: readonly SlackRow[] }): Map<string, ThreadFacts> {
  const facts = new Map<string, ThreadFacts>();
  for (const one of rows) {
    recordThreadMessage({ facts, key: KEY, ownerId: OWNER, row: one });
  }
  return facts;
}

describe("recordThreadMessage", () => {
  it("keeps the latest message, each author's latest, and whether anybody replied", () => {
    const early = row({ author: ALICE, seconds: 1_790_300_010 });
    const late = row({ author: ALICE, seconds: 1_790_300_030 });
    const mine = row({ author: OWNER, seconds: 1_790_300_020 });
    const facts = fold({ rows: [row({ author: OWNER, root: true, seconds: 1_790_300_000 }), late, mine, early] }).get(
      KEY,
    )!;
    expect(facts.latest).toBe(late);
    expect(facts.authors.get(ALICE)).toBe(late);
    expect(facts.authors.get(OWNER)).toBe(mine);
    expect(facts.hasReplies).toBe(true);
  });

  it("reads a root nobody threaded under as having no replies", () => {
    const facts = fold({ rows: [row({ author: OWNER, root: true, seconds: 1_790_300_000 })] }).get(KEY)!;
    expect(facts.hasReplies).toBe(false);
  });

  it("keeps every message of the owner's once, a copy from an overlapping window included", () => {
    const seconds = [5, 1, 4, 2, 3].map((offset) => 1_790_300_000 + offset);
    const rows = seconds.map((at) => row({ author: OWNER, seconds: at }));
    const facts = fold({ rows: [...rows, rows[0]!] }).get(KEY)!;
    expect([...facts.ownerWords.values()].map((mine) => mine.ownTs)).toEqual([
      1_790_300_005.0001, 1_790_300_001.0001, 1_790_300_004.0001, 1_790_300_002.0001, 1_790_300_003.0001,
    ]);
  });
});

describe("ownerStartedThread", () => {
  it("reads a thread whose root is the owner's as the owner's", () => {
    const facts = fold({
      rows: [
        row({ author: OWNER, root: true, seconds: 1_790_300_000 }),
        row({ author: ALICE, seconds: 1_790_300_010 }),
      ],
    }).get(KEY)!;
    expect(ownerStartedThread({ ownerWords: facts.ownerWords })).toBe(true);
  });

  it("reads a thread the owner only replied in as somebody else's", () => {
    const facts = fold({
      rows: [
        row({ author: ALICE, root: true, seconds: 1_790_300_000 }),
        row({ author: OWNER, seconds: 1_790_300_010 }),
      ],
    }).get(KEY)!;
    expect(ownerStartedThread({ ownerWords: facts.ownerWords })).toBe(false);
  });
});

describe("recordThreadMessage over two copies of one message", () => {
  it("keeps a tick either copy saw, whichever file is read last", () => {
    const stale = row({ author: OWNER, seconds: 1_790_300_003, text: "ok?" });
    const ticked = row({ answeringReactorIds: [ALICE], author: OWNER, seconds: 1_790_300_003, text: "ok?" });
    const reactorsAfter = ({ rows }: { rows: readonly SlackRow[] }): readonly string[] =>
      [...fold({ rows }).get(KEY)!.ownerWords.values()].flatMap((mine) => mine.answeringReactorIds);
    expect([reactorsAfter({ rows: [ticked, stale] }), reactorsAfter({ rows: [stale, ticked] })]).toEqual([
      [ALICE],
      [ALICE],
    ]);
  });
});

describe("recordThreadLine", () => {
  it("reads a reply's channel copy for its reactors only, and a followed reply into its thread", () => {
    const state = { broadcastReactors: new Map<string, readonly string[]>(), facts: new Map<string, ThreadFacts>() };
    const reply = row({ author: OWNER, seconds: 1_790_300_003, text: "ok?" });
    const channelCopy = JSON.stringify({
      author: OWNER,
      kind: "message",
      raw: { reactions: [{ count: 1, name: "+1", users: [ALICE] }], subtype: "thread_broadcast" },
      sourceId: "C0SYNCHANNEL1:1790300003.000100",
      tsIso: reply.tsIso,
    });
    const replyLine = JSON.stringify({ author: OWNER, kind: "comment", sourceId: reply.sourceId, tsIso: reply.tsIso });
    const counted = [channelCopy, replyLine].map((line) =>
      recordThreadLine({ keys: new Set([KEY]), line, ownerId: OWNER, state }),
    );
    joinBroadcastReactors(state);
    expect(counted).toEqual([0, 0]);
    expect([...state.facts.get(KEY)!.ownerWords.values()].map((mine) => mine.answeringReactorIds)).toEqual([[ALICE]]);
  });
});

describe("joinBroadcastReactors", () => {
  it("joins a tick on a reply's channel copy into the owner's matching word, by channel and own ts, and only that word", () => {
    const facts = fold({
      rows: [
        row({ author: OWNER, seconds: 1_790_300_003, text: "ok?" }),
        row({ author: OWNER, seconds: 1_790_300_004, text: "and?" }),
      ],
    });
    joinBroadcastReactors({
      broadcastReactors: new Map([
        ["C0SYNCHANNEL1:1790300003.000100", [ALICE]],
        ["C0SYNOTHER999:1790300004.000100", [BOB]],
      ]),
      facts,
    });
    expect([...facts.get(KEY)!.ownerWords.values()].map((mine) => mine.answeringReactorIds)).toEqual([[ALICE], []]);
  });
});

describe("awaitingCandidatesOf", () => {
  it("names every other author and every person the owner tagged who never spoke, and reads their ask off authored text", () => {
    const facts = fold({
      rows: [
        row({ author: APP, seconds: 1_790_300_001 }),
        row({ author: ALICE, seconds: 1_790_300_002 }),
        row({ author: OWNER, seconds: 1_790_300_003, text: `<@${BOB}> can you take this one?` }),
      ],
    });
    const [candidate] = awaitingCandidatesOf({ facts, members, ownerId: OWNER, selfIds: new Set() });
    expect(candidate!.channelId).toBe("C0SYNCHANNEL1");
    expect(candidate!.threadTs).toBe("1790300000.000100");
    expect(candidate!.channelName).toBe("a-channel");
    expect(candidate!.ownerWords[0]!.ask).toEqual({ asksQuestion: true, taggedIds: [BOB], tagsGroup: false });
    expect(
      candidate!.people.map((person) => [person.id, person.name, person.isHuman, person.taggable, person.lastIso]),
    ).toEqual([
      [APP, "An Alert App", false, false, "2026-09-25T01:33:21.000Z"],
      [ALICE, "Alice", true, true, "2026-09-25T01:33:22.000Z"],
      [BOB, "Bob", true, true, undefined],
    ]);
  });

  it("reads a tag of an app as asking nobody, so it names no one waited on", () => {
    const facts = fold({
      rows: [row({ author: OWNER, seconds: 1_790_300_003, text: `<@${APP}> open a PR fixing the flaky test` })],
    });
    const [candidate] = awaitingCandidatesOf({ facts, members, ownerId: OWNER, selfIds: new Set() });
    expect([candidate!.ownerWords[0]!.ask.taggedIds, candidate!.people]).toEqual([[], []]);
  });

  it("keeps only the PEOPLE who reacted to the owner's word, never the owner or an app", () => {
    const facts = fold({
      rows: [row({ answeringReactorIds: [OWNER, APP, ALICE], author: OWNER, seconds: 1_790_300_003, text: "ok?" })],
    });
    const [candidate] = awaitingCandidatesOf({ facts, members, ownerId: OWNER, selfIds: new Set() });
    expect(candidate!.ownerWords[0]!.reactedBy).toEqual([ALICE]);
  });

  it("hands the selection every message of the owner's, oldest first, and names who the earliest one tagged", () => {
    const facts = fold({
      rows: [5, 1, 4, 2, 3].map((offset) =>
        row({ author: OWNER, seconds: 1_790_300_000 + offset, text: offset === 1 ? `<@${BOB}> ok?` : "more" }),
      ),
    });
    const [candidate] = awaitingCandidatesOf({ facts, members, ownerId: OWNER, selfIds: new Set() });
    expect(candidate!.ownerWords.map((word) => word.ownTs)).toEqual([
      1_790_300_001.0001, 1_790_300_002.0001, 1_790_300_003.0001, 1_790_300_004.0001, 1_790_300_005.0001,
    ]);
    expect(candidate!.people.map((person) => person.id)).toEqual([BOB]);
  });
});
