/**
 * A release's pre-send re-read: what a person changed since the draft's own read, and whether a session's clearance
 * names exactly that. Approval age never enters it (owner turn EV8JeXO).
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  changedSet,
  conversationChanges,
  evaluateReleaseFreshness,
  readThroughOf,
  releaseReadFrom,
  releaseWatermark,
} from "../../../../outbound/slack/releaseFreshness.js";

const ROOT = { text: "is staging down?", ts: "1790000000.000100", user: "U0ADA" };
const ANSWERED = { text: "pool exhausted", thread_ts: ROOT.ts, ts: "1790000010.000100", user: "U0TOBIAS" };
const BOT_ACK = { bot_id: "B0BOT", text: ":eyes:", thread_ts: ROOT.ts, ts: "1790000011.000100", user: "U0SYNBOTUSER" };
/** The bot that posted {@link BOT_ACK}, as `auth.test` names it for the bot token. */
const BOT = { botId: "B0BOT", userId: "U0SYNBOTUSER" };
/** A person posting through an app — the owner's as-me token included — carries its `bot_id` beside their own `user`. */
const VIA_APP = {
  bot_id: "B0ASME",
  text: "fixed, ignore this",
  thread_ts: ROOT.ts,
  ts: "1790000020.000100",
  user: "U0ADA",
};

describe("readThroughOf — what a recording keeps of the thread it read", () => {
  it("keeps every message with its edit stamp whoever wrote it, the bot's own included, and the newest ts", () => {
    const edited = { ...ANSWERED, edited: { ts: "1790000012.000000", user: "U0TOBIAS" } };
    expect(readThroughOf({ rawMessages: [BOT_ACK, ROOT, edited] })).toEqual({
      seen: [{ ts: ROOT.ts }, { editedTs: "1790000012.000000", ts: ANSWERED.ts }, { ts: BOT_ACK.ts }],
      throughTs: BOT_ACK.ts,
    });
  });

  it("keeps a tombstone's ts as the read's end, never as a message it saw", () => {
    const tombstone = { subtype: "tombstone", ts: "1790000030.000100", user: "USLACKBOT" };
    expect(readThroughOf({ rawMessages: [ROOT, tombstone] })).toEqual({
      seen: [{ ts: ROOT.ts }],
      throughTs: tombstone.ts,
    });
  });

  it("keeps the zero ts from a read that held no message, never nothing — the row's instant is minted later", () => {
    expect(readThroughOf({ rawMessages: [] })).toEqual({ seen: [], throughTs: "0000000000.000000" });
  });
});

describe("releaseWatermark", () => {
  it("uses the row's own read-through when it kept one", () => {
    const readThrough = { seen: [{ ts: ROOT.ts }], throughTs: ANSWERED.ts };
    const watermark = releaseWatermark({ draft: { id: "sd-1", readThrough, tsIso: "2026-10-04T05:00:00.000Z" } });
    expect(unwrap(watermark)).toEqual({ seen: [{ ts: ROOT.ts }], throughTs: ANSWERED.ts });
  });

  it("falls back to the recording instant as a ts for a person-addressed or older row, keeping no snapshot", () => {
    const watermark = releaseWatermark({
      draft: { id: "sd-1", readThrough: undefined, tsIso: "2026-10-04T05:00:00.250Z" },
    });
    expect(unwrap(watermark)).toEqual({ seen: undefined, throughTs: "1791090000.250000" });
  });

  it("refuses a row whose recording instant is not a date", () => {
    const watermark = releaseWatermark({ draft: { id: "sd-1", readThrough: undefined, tsIso: "yesterday" } });
    expect(unwrapErr(watermark).code).toBe("SLACK_RELEASE_WATERMARK_INVALID");
  });
});

describe("releaseReadFrom — where a top-level re-read starts", () => {
  it("starts AT the first message the recording saw, so each one is read again for an edit or a removal", () => {
    const watermark = { seen: [{ ts: ROOT.ts }, { ts: ANSWERED.ts }], throughTs: BOT_ACK.ts };
    expect(releaseReadFrom({ watermark })).toBe(ROOT.ts);
  });

  it.each([
    ["a row that kept no snapshot", undefined],
    ["a snapshot holding no person's message", []],
  ])("starts at the watermark itself for %s", (_label, seen) => {
    expect(releaseReadFrom({ watermark: { seen, throughTs: BOT_ACK.ts } })).toBe(BOT_ACK.ts);
  });

  it("reads an empty recording's zero boundary from Slack's own start, never as an oldest Slack refuses", () => {
    const watermark = readThroughOf({ rawMessages: [] });
    expect(watermark.throughTs).toBe("0000000000.000000");
    expect(releaseReadFrom({ watermark })).toBe("0");
  });
});

describe("conversationChanges — what a person did since the draft's read", () => {
  const watermark = {
    seen: [{ ts: ROOT.ts }, { ts: ANSWERED.ts }],
    throughTs: ANSWERED.ts,
  };

  it("sees nothing when only the poster's own bot spoke since", () => {
    expect(conversationChanges({ rawMessages: [ROOT, ANSWERED, BOT_ACK], self: BOT, watermark })).toEqual({
      added: [],
      edited: [],
      removed: [],
    });
  });

  it("counts a person speaking through an app, bot_id and all", () => {
    expect(conversationChanges({ rawMessages: [ROOT, ANSWERED, VIA_APP], self: BOT, watermark }).added).toEqual([
      VIA_APP.ts,
    ]);
  });

  it("counts another bot's post — only the poster's own is left out", () => {
    expect(
      conversationChanges({ rawMessages: [ROOT, ANSWERED, BOT_ACK], self: { botId: "B0OTHER" }, watermark }).added,
    ).toEqual([BOT_ACK.ts]);
  });

  it("names a reply, an edit and a deletion separately", () => {
    const fixed = { text: "fixed it, ignore", thread_ts: ROOT.ts, ts: "1790000020.000100", user: "U0ADA" };
    const editedRoot = { ...ROOT, edited: { ts: "1790000021.000000", user: "U0ADA" } };
    const changes = conversationChanges({ rawMessages: [editedRoot, fixed], self: BOT, watermark });
    expect(changes).toEqual({ added: [fixed.ts], edited: [ROOT.ts], removed: [ANSWERED.ts] });
    expect(changedSet({ changes })).toEqual([ROOT.ts, ANSWERED.ts, fixed.ts]);
  });

  it("names an edit whose stamp is not a string, since it cannot show the message unchanged", () => {
    const numericStamp = { ...ANSWERED, edited: { ts: 1790000012 }, text: "pool fixed" };
    expect(conversationChanges({ rawMessages: [ROOT, numericStamp], self: BOT, watermark }).edited).toEqual([
      ANSWERED.ts,
    ]);
  });

  it("names an unreadable stamp again even when the recording kept the same one", () => {
    const unreadable = { ...ANSWERED, edited: [] };
    const kept = readThroughOf({ rawMessages: [ROOT, unreadable] });
    expect(kept.seen).toEqual([{ ts: ROOT.ts }, { editedTs: "unreadable", ts: ANSWERED.ts }]);
    expect(conversationChanges({ rawMessages: [ROOT, unreadable], self: BOT, watermark: kept }).edited).toEqual([
      ANSWERED.ts,
    ]);
  });

  it("reads a root deleted under its replies — Slack's tombstone — as removed", () => {
    const tombstone = { subtype: "tombstone", text: "This message was deleted.", ts: ROOT.ts, user: "USLACKBOT" };
    expect(conversationChanges({ rawMessages: [tombstone, ANSWERED], self: BOT, watermark }).removed).toEqual([
      ROOT.ts,
    ]);
  });

  it("sees a message posted after an EMPTY recording read as new", () => {
    const first = { text: "anyone?", ts: "1790000020.000100", user: "U0ADA" };
    const empty = readThroughOf({ rawMessages: [] });
    expect(conversationChanges({ rawMessages: [first], self: BOT, watermark: empty }).added).toEqual([first.ts]);
  });

  it("names a message posted AND deleted since the read, by the tombstone Slack left for it", () => {
    const tombstone = { subtype: "tombstone", ts: "1790000020.000100", user: "USLACKBOT" };
    const empty = readThroughOf({ rawMessages: [] });
    expect(conversationChanges({ rawMessages: [tombstone], self: BOT, watermark: empty })).toEqual({
      added: [],
      edited: [],
      removed: [tombstone.ts],
    });
  });

  describe("the bot's own post, which the recording kept like any other", () => {
    const recorded = readThroughOf({ rawMessages: [ROOT, ANSWERED, BOT_ACK] });
    const editedAck = { ...BOT_ACK, edited: { ts: "1790000013.000000" }, text: "done" };

    it("is not a change when its own bot edited it", () => {
      expect(conversationChanges({ rawMessages: [ROOT, ANSWERED, editedAck], self: BOT, watermark: recorded })).toEqual(
        { added: [], edited: [], removed: [] },
      );
    });

    it("is an edit when auth.test names no bot — an identity read wrong refuses more, never misses", () => {
      expect(
        conversationChanges({
          rawMessages: [ROOT, ANSWERED, editedAck],
          self: { userId: "U0SYNBOTUSER" },
          watermark: recorded,
        }).edited,
      ).toEqual([BOT_ACK.ts]);
    });

    it("is removed when it is gone, because nothing is left to say whose it was", () => {
      expect(conversationChanges({ rawMessages: [ROOT, ANSWERED], self: BOT, watermark: recorded }).removed).toEqual([
        BOT_ACK.ts,
      ]);
    });
  });

  it("sees additions, a newer tombstone and an edit stamped after the recording for a row that kept no read-through", () => {
    const fixed = { text: "fixed it", ts: "1790000020.000100", user: "U0ADA" };
    const editedAfter = { ...ROOT, edited: { ts: "1790000015.000000", user: "U0ADA" } };
    const editedBefore = { ...ANSWERED, edited: { ts: "1790000005.000000", user: "U0TOBIAS" } };
    const postedAndRemoved = { subtype: "tombstone", ts: "1790000030.000100", user: "USLACKBOT" };
    expect(
      conversationChanges({
        rawMessages: [editedAfter, editedBefore, fixed, postedAndRemoved],
        self: BOT,
        watermark: { seen: undefined, throughTs: ANSWERED.ts },
      }),
    ).toEqual({
      added: [fixed.ts],
      edited: [ROOT.ts],
      removed: [postedAndRemoved.ts],
    });
  });

  it("never sees an older message removed for a row that kept no read-through, since nothing recorded it", () => {
    expect(
      conversationChanges({ rawMessages: [ROOT], self: BOT, watermark: { seen: undefined, throughTs: ANSWERED.ts } }),
    ).toEqual({ added: [], edited: [], removed: [] });
  });
});

describe("evaluateReleaseFreshness", () => {
  const moved = { added: ["1790000020.000100"], edited: ["1790000000.000100"], removed: [] };

  it("sends when nothing moved, clearing nothing", () => {
    expect(
      unwrap(
        evaluateReleaseFreshness({
          changes: { added: [], edited: [], removed: [] },
          cleared: undefined,
          draftId: "sd-1",
        }),
      ),
    ).toEqual([]);
  });

  it("stops a moved conversation with the exact set and the three remedies — never a fresh approval", () => {
    const refused = unwrapErr(evaluateReleaseFreshness({ changes: moved, cleared: undefined, draftId: "sd-1" }));
    expect(refused.code).toBe("SLACK_RELEASE_THREAD_MOVED");
    expect(refused.message).toBe(
      "draft sd-1: the conversation moved since this draft read it (new: 1790000020.000100; edited: 1790000000.000100). " +
        "The owner's approval still stands; judge whether these change what the message means, then: send it as is with " +
        "--thread-moved-cleared 1790000000.000100,1790000020.000100; or withdraw it once the owner's word says so " +
        '(`slopweaver slack draft hold sd-1 --reason not-owner-yes --why "<what the owner said>"` then `slopweaver slack ' +
        'draft drop sd-1 --note "<why>"`); ' +
        'or, when it is no longer needed, send only thanks for the review in its place with `--thanks-instead "<one line>"` ' +
        "(an as-me row), which closes the row. Nothing was sent.",
    );
    expect(refused.message).not.toContain("re-record");
  });

  it("sends past exactly the cleared set, in any order, and returns it to journal", () => {
    const cleared = ["1790000020.000100", "1790000000.000100"];
    expect(unwrap(evaluateReleaseFreshness({ changes: moved, cleared, draftId: "sd-1" }))).toEqual([
      "1790000000.000100",
      "1790000020.000100",
    ]);
  });

  it("refuses a clearance one message short — the conversation moved again after it was judged", () => {
    const refused = unwrapErr(
      evaluateReleaseFreshness({ changes: moved, cleared: ["1790000000.000100"], draftId: "sd-1" }),
    );
    expect(refused.code).toBe("SLACK_RELEASE_CLEARANCE_MISMATCH");
    expect(refused.message).toContain("names 1790000000.000100, but what moved since its read is");
  });

  it("refuses a clearance when nothing moved at all", () => {
    const refused = unwrapErr(
      evaluateReleaseFreshness({
        changes: { added: [], edited: [], removed: [] },
        cleared: ["1790000000.000100"],
        draftId: "sd-1",
      }),
    );
    expect(refused.code).toBe("SLACK_RELEASE_CLEARANCE_MISMATCH");
  });
});
