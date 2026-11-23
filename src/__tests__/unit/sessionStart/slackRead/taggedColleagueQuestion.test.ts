/*
 * `readSlackThreads` on a question answering the owner's tag under somebody else's root: the tagged colleague's untagged
 * question reads as stopped on the owner only while their LATEST word names them, read off the authored mention run.
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

describe("readSlackThreads — a question answering the owner's tag under somebody else's root", () => {
  // The owner's word tagging the colleague, as the corpus stores one: the run in `raw.text`, a display name in `text`.
  const ownerTag = ({ ts, tsIso }: { ts: string; tsIso: string }): Record<string, unknown> =>
    message({
      author: OWNER,
      rawText: `<@${HUMAN}> need your call here. can we have that sign off?`,
      text: "@A Colleague need your call here. can we have that sign off?",
      ts,
      tsIso,
    });
  const theirQuestion = message({
    author: HUMAN,
    text: "Is it fixed cost or variable cost? I'm happy to approve that",
    ts: "1787708973.446169",
  });

  it("reads the tagged colleague's untagged question as one stopped on the owner", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [ownerTag({ ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }), theirQuestion],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => [one.ownerStartedThread, one.ownerLatestTagsLastAuthor])).toStrictEqual([
      [false, true],
    ]);
    expect(read.inputs[0]!.readings.stoppedOnOwner).toBe(5);
  });

  it("does not count a tag the owner has since moved past: their LATEST word must name them", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        ownerTag({ ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({
          author: OWNER,
          text: "never mind, sorted",
          ts: "1787708973.446165",
          tsIso: "2026-08-29T06:00:00.000Z",
        }),
        theirQuestion,
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => one.ownerLatestTagsLastAuthor)).toStrictEqual([false]);
    expect(read.inputs[0]!.readings.stoppedOnOwner).toBe(0);
  });

  it("reads the tag off the authored mention run, never a display name in the projected text", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, text: "@A Colleague can we have that sign off?", ts: "1787708973.446160" }),
        theirQuestion,
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => one.ownerLatestTagsLastAuthor)).toStrictEqual([false]);
  });
});
