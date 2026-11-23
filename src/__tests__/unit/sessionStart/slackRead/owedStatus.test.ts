/*
 * Whether the read `slack owed` takes from `readSlackThreads` is complete, unavailable or incomplete: a missing
 * corpus or owner id, an unreadable file, and every line that may hide a reply or a word of the owner's — truncated,
 * escaped, authorless, threadless or mis-dated — against the clean corpus that stays complete.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackThreads } from "../../../../cli/commands/sessionStart/slackRead.js";
import { BOT, HUMAN, home, homes, member, message, NOW, OWNER, tagging } from "./fixtures.js";

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("readSlackThreads — what `slack owed` reads", () => {
  it("reads a home with no Slack corpus as a COMPLETE empty read", () => {
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
    expect(read.status).toBe("complete");
    expect(read.movementThreads).toStrictEqual([]);
  });

  it("reads a profile with no owner id as UNAVAILABLE, never a complete empty read", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-slackread-"));
    homes.push(dir);
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] }),
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("unavailable");
    expect(read.movementThreads).toStrictEqual([]);
  });

  it("reads a corpus file that cannot be read as UNAVAILABLE, carrying the typed refusal", () => {
    const dir = home({ records: [] });
    // A directory where a bronze file should be: listed as `.jsonl`, and unreadable as one.
    mkdirSync(join(dir, "corpus", "bronze", "slack", "broken.jsonl"));
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("unavailable");
    expect(read.refusal!.code).toBe("EISDIR");
    expect(read.couldNotSee[0]).toContain("a corpus file could not be read");
  });

  it("reads a truncated reply in a thread the owner follows as INCOMPLETE, never a complete empty read", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    // The reply that decides the thread, cut off mid-record: its sourceId is readable, its body is not.
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      '{"sourceId":"channel-one:1787705115.489199:reply:1787705200.000100","author":"UHUMAN","tsIso":"2026-08-30T00:01:00.000Z"\n',
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.couldNotSee[0]).toBe(
      "1 corpus line(s) in a thread you follow, or carrying your id, did not parse as a message, so a reply or a message of yours may be missing from what is listed",
    );
  });

  it("reads a reply whose sourceId is spelled with whitespace, so the owner's own word is not left looking last", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" })],
    });
    // Legal JSON the substring fast path cannot read: a space after `"sourceId":`.
    const reply = JSON.stringify(
      message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
    ).replace('"sourceId":"', '"sourceId": "');
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${reply}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.movedWithoutOwner).toBe(1);
    expect(read.inputs[0]!.item.who).toBe("A Colleague");
  });

  it("reads a truncated reply whose sourceId is spelled with whitespace as INCOMPLETE", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      '{"sourceId": "channel-one:1787705115.489199:reply:1787705200.000100","author":"UHUMAN"\n',
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
  });

  it("reads a truncated reply whose sourceId KEY is unicode-escaped as INCOMPLETE", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      '{"\\u0073ourceId":"channel-one:1787705115.489199:reply:1787705200.000100","author":"UHUMAN"}\n',
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
  });

  it("reads a reply whose sourceId key appears twice by the key JSON.parse keeps, the last", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" })],
    });
    // The substring read takes the FIRST key, an unwatched thread; JSON.parse keeps the second, the owner's.
    const whole = JSON.stringify(
      message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" }),
    );
    const reply = `{"sourceId":"channel-elsewhere:1:reply:1",${whole.slice(1)}`;
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${reply}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.movedWithoutOwner).toBe(1);
  });

  it("keeps a read COMPLETE past an escaped non-message line of a thread the owner does not follow", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      '{"sourceId":"channel-elsewhere:1:reply:1","note":"caf\\u00e9"}\n',
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
  });

  it("keeps a read COMPLETE past an authorless file share carrying the owner's id, which is nobody's reply", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      `{"kind":"file","source":"slack","sourceId":"channel-one:1787705115.489199:file:F1","text":"shared by ${OWNER}","tsIso":"2026-08-30T00:02:00.000Z"}\n`,
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
  });

  it("keeps a read COMPLETE past an authorless bot reply in a followed thread, which is no person's word", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    const { author: _dropped, ...bot } = message({ author: BOT, ts: "1787705200.000100" });
    const reply = { ...bot, raw: { bot_id: "B0BOT12345", subtype: "bot_message" } };
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${JSON.stringify(reply)}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
  });

  it("reads an authorless comment with no bot id in a followed thread as INCOMPLETE — a person's reply may be lost", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    const { author: _dropped, ...reply } = message({ author: HUMAN, ts: "1787705200.000100" });
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${JSON.stringify(reply)}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.movementThreads).toStrictEqual([]);
  });

  it("reads a message in a followed thread whose author is null as INCOMPLETE", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    const reply = { ...message({ author: HUMAN, ts: "1787705200.000100" }), author: null };
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${JSON.stringify(reply)}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
  });

  it("finds the owner's own message whose author id is spelled in a unicode escape, which the raw id never matches", () => {
    const dir = home({
      members: [member({ id: HUMAN, name: "A Colleague" })],
      records: [message({ author: HUMAN, ts: "1787708973.446169", tsIso: "2026-08-30T00:00:00.000Z" })],
    });
    // Legal JSON for the same record: the "U" of the owner's id written \u0055, so the raw line never contains OWNER.
    const ownerLine = JSON.stringify(
      message({ author: OWNER, ts: "1787708973.446160", tsIso: "2026-08-29T00:00:00.000Z" }),
    ).replace(`"author":"${OWNER}"`, `"author":"\\u0055${OWNER.slice(1)}"`);
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${ownerLine}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.threadsSpokenIn).toBe(1);
    expect(read.movedWithoutOwner).toBe(1);
    expect(read.inputs[0]!.item.who).toBe("A Colleague");
  });

  it("finds a mention of the owner whose id is spelled in a unicode escape", () => {
    const dir = home({ members: [member({ id: HUMAN, name: "A Colleague" })], records: [] });
    const ask = JSON.stringify(
      tagging({ author: HUMAN, says: "can you take a look?", ts: "1787708973.446169" }),
    ).replace(`<@${OWNER}>`, `<@\\u0055${OWNER.slice(1)}>`);
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), `${ask}\n`);
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.taggedWithoutOwner).toBe(1);
    expect(read.inputs).toHaveLength(1);
  });

  it("rows nothing for an escaped message that is neither the owner's nor tags the owner, and stays COMPLETE", () => {
    const dir = home({ records: [] });
    appendFileSync(
      join(dir, "corpus", "bronze", "slack", "window.jsonl"),
      `${JSON.stringify(message({ author: HUMAN, text: "caf\u00e9", ts: "1787708973.446169" }))}\n`,
    );
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.threadsSpokenIn).toBe(0);
    expect(read.taggedWithoutOwner).toBe(0);
    expect(read.inputs).toStrictEqual([]);
  });

  it("reads the owner's own message whose id names no thread as INCOMPLETE — a word of the owner's was lost", () => {
    const dir = home({ records: [{ ...message({ author: OWNER, ts: "1787705115.489199" }), sourceId: "malformed" }] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(0);
  });

  it("reads a mention of the owner whose id names no thread as INCOMPLETE", () => {
    const ask = {
      ...tagging({ author: HUMAN, says: "can you look?", ts: "1787708973.446169" }),
      sourceId: "malformed",
    };
    const read = readSlackThreads({ home: home({ records: [ask] }), nowIso: NOW });
    expect(read.status).toBe("incomplete");
  });

  it("reads a threadless message that is neither the owner's nor tags the owner as INCOMPLETE — no thread can be ruled out", () => {
    const other = { ...message({ author: HUMAN, ts: "1787708973.446169" }), sourceId: "malformed" };
    const read = readSlackThreads({ home: home({ records: [other] }), nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(0);
  });

  it("reads a reply whose id names no thread as INCOMPLETE once the owner follows a thread — it may be that thread's reply", () => {
    const lost = { ...message({ author: HUMAN, ts: "1787708973.446169" }), sourceId: "malformed" };
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" }), lost] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(1);
  });

  it("reads a broken reply whose id names no thread as INCOMPLETE once the owner follows a thread", () => {
    const broken = { ...message({ author: HUMAN, ts: "1787708973.446169" }), author: null, sourceId: "malformed" };
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" }), broken] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(1);
  });

  it("reads the owner's message whose id is not a Slack channel and ts as INCOMPLETE, never as a thread of its own", () => {
    const odd = { ...message({ author: OWNER, ts: "1787705115.489199" }), sourceId: "malformed:not-a-slack-thread-ts" };
    const read = readSlackThreads({ home: home({ records: [odd] }), nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(0);
  });

  it("stays COMPLETE past a huddle of the owner's, which is nobody's reply and no thread", () => {
    const huddle = {
      ...message({ author: OWNER, ts: "1787705115.489199" }),
      kind: "huddle",
      sourceId: "huddle:F0AB12CD34E:chunk:3",
    };
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489100" }), huddle] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.threadsSpokenIn).toBe(1);
  });

  it("reads a reply with no sourceId at all as INCOMPLETE once the owner follows a thread", () => {
    const { sourceId: _dropped, ...idless } = message({ author: HUMAN, ts: "1787708973.446169" });
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" }), idless] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("incomplete");
    expect(read.threadsSpokenIn).toBe(1);
  });

  it("stays COMPLETE past a blank line", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    appendFileSync(join(dir, "corpus", "bronze", "slack", "window.jsonl"), "\n   \n");
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
  });

  it.each(["zzzz", "9999-99-99T99:99:99Z", "2026-02-30T00:00:00Z"])(
    "reads the owner's message with tsIso %s as INCOMPLETE, never as the last word over a real reply",
    (tsIso) => {
      const dir = home({
        records: [
          message({ author: OWNER, ts: "1787705115.489199", tsIso }),
          message({ author: HUMAN, ts: "1787705200.000100", tsIso: "2026-08-30T00:00:00.000Z" }),
        ],
      });
      const read = readSlackThreads({ home: dir, nowIso: NOW });
      expect(read.status).toBe("incomplete");
    },
  );

  it("reads a clean corpus as COMPLETE, so the incomplete arm is not the default", () => {
    const dir = home({ records: [message({ author: OWNER, ts: "1787705115.489199" })] });
    const read = readSlackThreads({ home: dir, nowIso: NOW });
    expect(read.status).toBe("complete");
  });
});
