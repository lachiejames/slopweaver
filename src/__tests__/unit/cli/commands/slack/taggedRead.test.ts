import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  afterDateOf,
  liveCandidatesOf,
  liveTrailOf,
  peopleResolver,
  readTaggedCorpus,
} from "../../../../../cli/commands/slack/taggedRead.js";
import { APP, bronze, CORPUS_NEWEST, HUMAN, hit, NOW, OWNER, STRANGER, taggedHome } from "./taggedFixture.js";

const SINCE = "2026-09-23T00:00:00.000Z";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const author = peopleResolver({
  members: new Map([
    [HUMAN, { active: true, bot: false, name: "A Colleague" }],
    [APP, { active: true, bot: true, name: "DLP" }],
  ]),
  selfIds: new Set(),
});

/**
 * Read the corpus leg of a fresh home.
 *
 * @param files the bronze window files
 * @returns the leg
 */
function corpusOf({
  files,
}: {
  files: readonly (readonly Record<string, unknown>[])[];
}): ReturnType<typeof readTaggedCorpus> {
  const home = taggedHome({ files });
  homes.push(home);
  return readTaggedCorpus({ author, home, nowIso: NOW, ownerId: OWNER, sinceIso: SINCE });
}

describe("readTaggedCorpus", () => {
  it("keeps every tag in the window, one row per message however many files hold a copy", () => {
    const reply = bronze({
      author: HUMAN,
      rootTs: "1790001000.000100",
      tags: true,
      ts: "1790001050.000100",
      tsIso: "2026-09-29T00:00:00.000Z",
    });
    const root = bronze({ author: HUMAN, tags: true, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" });
    const leg = corpusOf({ files: [[root, reply], [reply]] });
    expect(leg.kind).toBe("read");
    const read = leg as Extract<typeof leg, { kind: "read" }>;
    expect(read.candidates.map((one) => one.messageKey).toSorted()).toStrictEqual([
      "C0CHAN1:1790000000.000100",
      "C0CHAN1:1790001050.000100",
    ]);
    const tagged = read.candidates.find((one) => one.messageKey === "C0CHAN1:1790001050.000100")!;
    expect(tagged.threadKey).toBe("C0CHAN1:1790001000.000100");
    expect(tagged.authorName).toBe("A Colleague");
    expect(tagged.text).toBe("@Owner Name can you look at this");
  });

  it("drops a tag outside the window at either end, and a message that does not tag the owner", () => {
    const leg = corpusOf({
      files: [
        [
          bronze({ author: HUMAN, tags: true, ts: "1789000000.000100", tsIso: "2026-09-01T00:00:00.000Z" }),
          bronze({ author: HUMAN, tags: true, ts: "1791000000.000100", tsIso: "2026-10-01T00:00:00.000Z" }),
          bronze({ author: HUMAN, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" }),
        ],
      ],
    });
    expect((leg as Extract<typeof leg, { kind: "read" }>).candidates).toStrictEqual([]);
  });

  it("records the owner's own words on the trail, by thread and by one-to-one DM", () => {
    const leg = corpusOf({
      files: [
        [
          bronze({
            author: OWNER,
            rootTs: "1790000000.000100",
            ts: "1790000100.000100",
            tsIso: "2026-09-28T01:00:00.000Z",
          }),
          bronze({
            author: OWNER,
            channel: "D0SYNDIRECT1",
            ts: "1790000200.000100",
            tsIso: "2026-09-28T02:00:00.000Z",
          }),
        ],
      ],
    });
    const read = leg as Extract<typeof leg, { kind: "read" }>;
    expect([...read.trail.byThread.entries()]).toStrictEqual([
      ["C0CHAN1:1790000000.000100", Number("1790000100.000100")],
      ["D0SYNDIRECT1:1790000200.000100", Number("1790000200.000100")],
    ]);
    expect([...read.trail.byDm.entries()]).toStrictEqual([["D0SYNDIRECT1", Number("1790000200.000100")]]);
  });

  it("marks an app's tag as not a person's, and an author the index does not know as unknown", () => {
    const leg = corpusOf({
      files: [
        [
          bronze({ author: APP, tags: true, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" }),
          bronze({ author: STRANGER, tags: true, ts: "1790000300.000100", tsIso: "2026-09-28T03:00:00.000Z" }),
        ],
      ],
    });
    const read = leg as Extract<typeof leg, { kind: "read" }>;
    const app = read.candidates.find((one) => one.authorId === APP)!;
    const stranger = read.candidates.find((one) => one.authorId === STRANGER)!;
    expect([app.authorIsHuman, app.authorKnown]).toStrictEqual([false, true]);
    expect([stranger.authorIsHuman, stranger.authorKnown, stranger.authorName]).toStrictEqual([true, false, STRANGER]);
  });

  it("counts a malformed message carrying the owner's id as a tag it may have lost", () => {
    const leg = corpusOf({
      files: [[{ author: 5, kind: "comment", sourceId: "C0CHAN1:1790000000.000100", text: `<@${OWNER}>` }]],
    });
    expect((leg as Extract<typeof leg, { kind: "read" }>).unparsed).toBe(1);
  });

  it("reads the corpus's newest message off its watermark, and none when it carries no watermark", () => {
    const one = [[bronze({ author: HUMAN, tags: true, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" })]];
    const marked = corpusOf({ files: one });
    const unmarked = taggedHome({ files: one, watermark: null });
    homes.push(unmarked);
    const bare = readTaggedCorpus({ author, home: unmarked, nowIso: NOW, ownerId: OWNER, sinceIso: SINCE });
    expect((marked as Extract<typeof marked, { kind: "read" }>).newestIso).toBe(CORPUS_NEWEST);
    expect((bare as Extract<typeof bare, { kind: "read" }>).newestIso).toBeUndefined();
  });

  it("reads each channel's own crawl cursor, and none for a channel never crawled", () => {
    const one = [[bronze({ author: HUMAN, tags: true, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" })]];
    const home = taggedHome({ channelReach: { C0CHAN1: "2026-09-29T03:00:00.000Z" }, files: one });
    homes.push(home);
    const leg = readTaggedCorpus({ author, home, nowIso: NOW, ownerId: OWNER, sinceIso: SINCE });
    const reach = (leg as Extract<typeof leg, { kind: "read" }>).channelReach;
    expect([...reach.entries()]).toStrictEqual([["C0CHAN1", "2026-09-29T03:00:00.000Z"]]);
  });

  it("caps a pooled watermark banked in the future at the furthest any channel was crawled", () => {
    const one = [[bronze({ author: HUMAN, tags: true, ts: "1790000000.000100", tsIso: "2026-09-28T00:00:00.000Z" })]];
    const home = taggedHome({
      channelReach: { C0CHAN1: "2026-09-29T03:00:00.000Z", C0CHAN2: "2026-09-29T09:00:00.000Z" },
      files: one,
      watermark: "2026-10-01",
    });
    homes.push(home);
    const leg = readTaggedCorpus({ author, home, nowIso: NOW, ownerId: OWNER, sinceIso: SINCE });
    expect((leg as Extract<typeof leg, { kind: "read" }>).newestIso).toBe("2026-09-29T09:00:00.000Z");
  });

  it("is unavailable, never an empty read, when the home holds no Slack corpus file", () => {
    expect(corpusOf({ files: [] })).toStrictEqual({
      kind: "unavailable",
      reason: "this home holds no Slack corpus, so nothing was read",
    });
  });
});

describe("liveCandidatesOf", () => {
  it("keeps a real tag, drops the owner's own hit, a hit without a mention run of the owner, one outside the window, and counts an authorless message once however often it repeats", () => {
    const found = liveCandidatesOf({
      author,
      matches: [
        hit({ rootTs: "1790001000.000100", ts: "1790001050.000100", tsIso: "2026-09-29T00:00:00.000Z", userId: HUMAN }),
        hit({ ts: "1790001060.000100", tsIso: "2026-09-29T00:01:00.000Z", userId: OWNER }),
        hit({ tags: false, ts: "1790001070.000100", tsIso: "2026-09-29T00:02:00.000Z", userId: HUMAN }),
        hit({ ts: "1791000000.000100", tsIso: "2026-10-01T00:00:00.000Z", userId: HUMAN }),
        hit({ ts: "1790001080.000100", tsIso: "2026-09-29T00:03:00.000Z", userId: "" }),
        hit({ ts: "1790001080.000100", tsIso: "2026-09-29T00:03:00.000Z", userId: "" }),
        hit({ ts: "1790001080.000100", tsIso: "2026-09-29T00:03:00.000Z", userId: "" }),
      ],
      nowIso: NOW,
      ownerId: OWNER,
      sinceIso: SINCE,
    });
    expect(found.authorless).toBe(1);
    expect(found.candidates).toHaveLength(1);
    const [only] = found.candidates;
    expect(only!.messageKey).toBe("C0CHAN1:1790001050.000100");
    expect(only!.threadKey).toBe("C0CHAN1:1790001000.000100");
    expect(only!.text).toBe(`@${OWNER} ping @A Colleague`);
  });

  it("keeps one candidate when a page repeats a hit", () => {
    const repeated = hit({ ts: "1790001050.000100", tsIso: "2026-09-29T00:00:00.000Z", userId: HUMAN });
    const found = liveCandidatesOf({
      author,
      matches: [repeated, repeated],
      nowIso: NOW,
      ownerId: OWNER,
      sinceIso: SINCE,
    });
    expect(found.candidates).toHaveLength(1);
  });
});

describe("liveTrailOf", () => {
  it("keys the owner's reply on its root from the permalink, and ignores anybody else's and anything after now", () => {
    const trail = liveTrailOf({
      matches: [
        hit({ rootTs: "1790001000.000100", ts: "1790001100.000100", tsIso: "2026-09-29T01:00:00.000Z", userId: OWNER }),
        hit({ ts: "1790001200.000100", tsIso: "2026-09-29T02:00:00.000Z", userId: HUMAN }),
        hit({ ts: "1791000000.000100", tsIso: "2026-10-01T00:00:00.000Z", userId: OWNER }),
      ],
      nowIso: NOW,
      ownerId: OWNER,
    });
    expect([...trail.byThread.entries()]).toStrictEqual([["C0CHAN1:1790001000.000100", Number("1790001100.000100")]]);
    expect(trail.byDm.size).toBe(0);
  });
});

describe("afterDateOf", () => {
  it("names the day before the window opens, because after: excludes the date it names", () => {
    expect(afterDateOf({ sinceIso: SINCE })).toBe("2026-09-22");
  });
});
