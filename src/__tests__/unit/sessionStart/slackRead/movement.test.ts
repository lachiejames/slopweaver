/*
 * `readSlackThreads`'s thread-movement detector: a thread the owner spoke in whose last word is a person's rows, one they
 * or a bot closed only counts, the window and the sourceId join bound it, and a home with no corpus or no owner
 * id reads as empty or refused.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads, WINDOW_DAYS } from "../../../../cli/commands/sessionStart/slackRead.js";
import { APP, BOT, HUMAN, home, homes, member, message, NOW, OWNER } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads", () => {
  it("finds a thread the owner spoke in whose last word is somebody else's", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsSpokenIn).toBe(1);
    expect(read.movedWithoutOwner).toBe(1);
    expect(read.inputs).toHaveLength(1);
    expect(read.inputs[0]!.item.who).toBe("A Colleague");
  });

  it("counts a thread the owner closed themselves but never rows it", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: HUMAN, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: OWNER, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsSpokenIn).toBe(1);
    expect(read.movedWithoutOwner).toBe(0);
    expect(read.inputs).toStrictEqual([]);
  });

  it("counts a thread the bot answered last but never rows it", () => {
    const dir = home({
      members: [member({ id: BOT, name: "the bot" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: BOT, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movedWithoutOwner).toBe(1);
    expect(read.inputs).toStrictEqual([]);
  });

  it("never rows Slackbot, which Slack itself reports as not a bot", () => {
    const dir = home({
      members: [member({ bot: false, id: "USLACKBOT", name: "Slackbot" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: "USLACKBOT", ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).inputs).toStrictEqual([]);
  });

  it("never rows an app the members index marks as a bot", () => {
    const dir = home({
      members: [member({ bot: true, id: APP, name: "An App" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: APP, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).inputs).toStrictEqual([]);
  });

  it("ignores a thread whose only message of the owner's predates the window", () => {
    const outside = new Date(Date.parse(NOW) - (WINDOW_DAYS + 1) * 86_400_000).toISOString();
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: outside }),
        message({ author: HUMAN, ts: "1787708973.446169", tsIso: outside }),
      ],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).threadsSpokenIn).toBe(0);
  });

  it("joins on sourceId, so two threads sharing a timestamp fraction stay apart", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [
        message({ author: OWNER, threadTs: "1787705115.489199", ts: "1787708973.446160" }),
        message({ author: HUMAN, threadTs: "1787705115.489199", ts: "1787708973.446169" }),
        message({ author: HUMAN, threadTs: "1787999999.489199", ts: "1787999999.446169" }),
      ],
    });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.threadsSpokenIn).toBe(1);
    expect(read.inputs[0]!.item.nativeId).toBe("channel-one:1787705115.489199");
  });

  it("names an unresolvable author by its own id rather than dropping the row", () => {
    const dir = home({
      members: [],
      records: [
        message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
        message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
      ],
    });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).inputs[0]!.item.who).toBe(HUMAN);
  });

  it("carries a limit saying nothing was read live", () => {
    const dir = home({ members: [], records: [] });
    expect(readSlackThreads({ home: dir, nowIso: NOW }).couldNotSee[0]).toContain("nothing was re-read live");
  });

  it("treats a home with no Slack corpus as empty rather than as a failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-slackread-"));
    homes.push(dir);
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { ownerUserId: OWNER, selfUserIds: [BOT] },
        sources: [],
      }),
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.inputs).toStrictEqual([]);
    expect(read.refusal).toBeUndefined();
  });

  it("refuses with a reason when the profile declares no owner id", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-slackread-"));
    homes.push(dir);
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] }),
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.inputs).toStrictEqual([]);
    expect(read.couldNotSee[0]).toContain("slackBot.ownerUserId");
  });
});
