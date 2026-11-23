/*
 * What `slack awaiting` reads off `readSlackThreads`: one candidate per thread the owner spoke in, their ask read off
 * `raw.text` and the people named, and none for a thread they were only tagged in.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads } from "../../../../cli/commands/sessionStart/slackRead.js";
import { APP, HUMAN, home, homes, member, message, NOW, OWNER, tagging } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — what `slack awaiting` reads", () => {
  it("builds one candidate per thread the owner spoke in, their ask read off raw.text and the people named", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" }), member({ bot: true, id: APP, name: "An App" })],
      records: [
        message({ author: HUMAN, ts: "1787708973.446150", tsIso: "2026-08-28T00:00:00.000Z" }),
        message({
          author: OWNER,
          rawText: `<@${HUMAN}> did the migration land?`,
          text: "@A Colleague did the migration land?",
          ts: "1787708973.446160",
          tsIso: "2026-08-29T00:00:00.000Z",
        }),
        message({ author: APP, ts: "1787708973.446169", tsIso: "2026-08-29T01:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.awaitingCandidates).toHaveLength(1);
    const candidate = read.awaitingCandidates[0]!;
    expect([candidate.channelId, candidate.threadTs, candidate.hasReplies]).toStrictEqual([
      "channel-one",
      "1787705115.489199",
      true,
    ]);
    expect(candidate.ownerWords.map((word) => word.ask)).toStrictEqual([
      { asksQuestion: true, taggedIds: [HUMAN], tagsGroup: false },
    ]);
    expect(candidate.people.map((person) => [person.id, person.isHuman, person.taggable])).toStrictEqual([
      [HUMAN, true, true],
      [APP, false, false],
    ]);
  });

  it("builds no candidate for a thread the owner was only tagged in", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" })],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).awaitingCandidates).toStrictEqual([]);
  });
});
