/*
 * `readSlackThreads` on a first-time mention: a thread the owner was tagged in and has not spoken in since rows once,
 * at its latest ask, with its linked pull request, and never for a bot, a stale tag or a thread the owner answered.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads, WINDOW_DAYS } from "../../../../cli/commands/sessionStart/slackRead.js";
import { bareRefs } from "../../../../sessionStart/staleRefs.js";
import { APP, BOT, HUMAN, home, homes, member, message, NOW, OWNER, tagging } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — a first-time mention", () => {
  it("rows a thread the owner was tagged in and has not spoken in since", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" })],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsTagging).toBe(1);
    expect(read.taggedWithoutOwner).toBe(1);
    expect(read.inputs).toHaveLength(1);
    expect(read.inputs[0]!.item.who).toBe("A Colleague");
    expect(read.inputs[0]!.item.provenance).toBe(
      "slack leg — somebody tagged you and you have not spoken in the thread since",
    );
  });

  // The r1 review's own counterexample. The suppression set is window-bounded like everything else the
  // reader touches, so a message of the owner's from BEFORE the window never enters it and the thread still rows.
  // That is sound for the job — the tag is inside the window, so any reply to it would be too — and it is
  // why no sentence this leg writes says the owner has NEVER spoken there.
  it("still rows a thread whose only word of the owner's predates the window, and claims only 'since'", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787108973.446160", tsIso: "2026-08-01T00:00:00.000Z" }),
        tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsSpokenIn).toBe(0);
    expect(read.taggedWithoutOwner).toBe(1);
    expect(read.inputs).toHaveLength(1);
    expect(read.inputs[0]!.item.provenance).toBe(
      "slack leg — somebody tagged you and you have not spoken in the thread since",
    );
    expect(read.inputs[0]!.item.background).toContain("that you have not spoken in since");
    expect(read.inputs[0]!.item.state).toBe("tagged by A Colleague, and no word from you in the thread since");
    expect(read.inputs[0]!.trace.carried[0]!.what).toContain("you have not spoken in that thread since");
  });

  it("rows nothing for the same thread once the owner has answered in it", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" }),
        message({ author: OWNER, ts: "1787708973.446179", tsIso: "2026-08-30T01:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsTagging).toBe(1);
    expect(read.taggedWithoutOwner).toBe(0);
    expect(read.inputs).toStrictEqual([]);
  });

  it("never rows one thread twice: a thread the owner spoke in belongs to the movement detector alone", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        tagging({ author: HUMAN, says: "bump", ts: "1787708973.446169" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movedWithoutOwner).toBe(1);
    expect(read.taggedWithoutOwner).toBe(0);
    expect(read.inputs).toHaveLength(1);
    expect(read.inputs[0]!.item.provenance).toBe(
      "slack leg — a thread you spoke in whose last word is somebody else's",
    );
  });

  it("never rows a mention from an app the members index marks as a bot", () => {
    const dir = home({
      members: [member({ bot: true, id: APP, name: "Nightfall-shaped alert app" })],
      records: [tagging({ author: APP, says: "policy violation detected", ts: "1787708973.446169" })],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.taggedWithoutOwner).toBe(1);
    expect(read.inputs).toStrictEqual([]);
  });

  it("never rows a mention from Slopweaver's own bot", () => {
    const dir = home({
      members: [member({ id: BOT, name: "the bot" })],
      records: [tagging({ author: BOT, says: "here is your answer", ts: "1787708973.446169" })],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).inputs).toStrictEqual([]);
  });

  it("ignores a mention older than the window", () => {
    const outside = new Date(Date.parse(NOW) - (WINDOW_DAYS + 1) * 86_400_000).toISOString();
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [tagging({ author: HUMAN, says: "bump", ts: "1787708973.446169", tsIso: outside })],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsTagging).toBe(0);
    expect(read.inputs).toStrictEqual([]);
  });

  it("keeps the LATEST mention in a thread, so the row lands on the live ask", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        tagging({ author: HUMAN, says: "first ask", ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        tagging({ author: HUMAN, says: "bumping this", ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.inputs).toHaveLength(1);
    expect(read.inputs[0]!.item.whenIso).toBe("2026-08-30T00:00:00.000Z");
    expect(read.inputs[0]!.item.background).toContain("bumping this");
  });

  it("carries the linked pull request so the live re-read can settle the row", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        tagging({
          author: HUMAN,
          says: "review please https://github.com/acme/acme-admin/pull/17316",
          ts: "1787708973.446169",
        }),
      ],
    });
    const item = readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.item;
    expect(item.repo).toBe("acme/acme-admin");
    expect(bareRefs({ text: item.doneWhen })).toStrictEqual([17_316]);
  });

  it("never lets a number quoted in prose reach doneWhen, where it would be checked against the wrong repo", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        tagging({
          author: HUMAN,
          says: "this is like #42 was — review https://github.com/acme/acme-admin/pull/17316",
          ts: "1787708973.446169",
        }),
      ],
    });
    const item = readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.item;
    expect(bareRefs({ text: item.doneWhen })).toStrictEqual([17_316]);
    expect(item.background).toContain("#42");
  });

  it("scores a channel mention as addressed, which the projected-text read never could", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [tagging({ author: HUMAN, says: "bump this", ts: "1787708973.446169" })],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.readings.directness).toBe(3);
  });
});
