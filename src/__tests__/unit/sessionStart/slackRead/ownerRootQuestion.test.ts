/*
 * `readSlackThreads` on a question under the owner's own post: an untagged one reads as stopped on the owner, and one tagging a
 * colleague stays that colleague's.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads } from "../../../../cli/commands/sessionStart/slackRead.js";
import { HUMAN, home, homes, member, message, NOW, OWNER } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — a question under the owner's own post", () => {
  // The thread's ROOT, as the corpus stores one: `channel:ownTs`, no `:reply:` segment.
  const ownerRoot = message({ author: OWNER, ts: "1787705115.489199", tsIso: "2026-08-29T00:00:00.000Z" });
  const rootRecord = { ...ownerRoot, sourceId: "channel-one:1787705115.489199" };

  it("reads an untagged question under the owner's own post as one stopped on the owner", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        rootRecord,
        message({ author: HUMAN, text: "As in, what are you trying to achieve there?", ts: "1787708973.446169" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => [one.ownerStartedThread, one.lastNamesAnybody])).toStrictEqual([
      [true, false],
    ]);
    expect(read.inputs[0]!.readings.stoppedOnOwner).toBe(5);
  });

  it("leaves a question under the owner's own post that tags a colleague as that colleague's", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        rootRecord,
        message({
          author: HUMAN,
          rawText: "<@U0SYNOTHER123> can you tick this?",
          text: "@Other can you tick this?",
          ts: "1787708973.446169",
        }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => [one.ownerStartedThread, one.lastNamesAnybody])).toStrictEqual([
      [true, true],
    ]);
    expect(read.inputs[0]!.readings.stoppedOnOwner).toBe(0);
  });
});
