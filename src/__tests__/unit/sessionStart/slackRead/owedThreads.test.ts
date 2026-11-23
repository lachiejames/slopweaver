/*
 * What `slack owed` reads off `readSlackThreads`'s `movementThreads`: the owner's LATEST word as `ownerLastIso`, a
 * bot-answered thread kept before the non-human filter, and a mention-only thread left out.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads } from "../../../../cli/commands/sessionStart/slackRead.js";
import { BOT, HUMAN, home, homes, member, message, NOW, OWNER, tagging } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — what `slack owed` reads", () => {
  it("reports the owner's latest message in the thread as ownerLastIso, not the first", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-28T00:00:00.000Z" }),
        message({ author: OWNER, ts: "1787708973.446165", tsIso: "2026-08-29T06:00:00.000Z" }),
        message({ author: OWNER, ts: "1787708973.446161", tsIso: "2026-08-28T12:00:00.000Z" }),
        message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.movementThreads.map((one) => one.ownerLastIso)).toStrictEqual(["2026-08-29T06:00:00.000Z"]);
    expect(read.movementThreads.map((one) => one.lastIso)).toStrictEqual(["2026-08-30T00:00:00.000Z"]);
  });

  it("carries a bot-answered thread in movementThreads, before the non-human filter", () => {
    const dir = home({
      members: [member({ id: BOT, name: "the bot" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: BOT, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movementThreads.map((one) => one.lastAuthorIsHuman)).toStrictEqual([false]);
    expect(read.inputs).toStrictEqual([]);
  });

  it("keeps a mention-only thread in inputs but never in movementThreads", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" })],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.inputs).toHaveLength(1);
    expect(read.movementThreads).toStrictEqual([]);
    expect(read.taggedWithoutOwner).toBe(1);
  });
});
