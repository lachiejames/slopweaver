/**
 * The third way to be addressed: a reply under one of the bot's OWN posts. Pure input, exact assertions, no
 * socket.
 *
 * The three verdicts the owner's ruling turns on are the first three cases below — a reply rooted at a
 * bot post, a reply rooted at a human's, and a top-level channel message — because the whole risk of this
 * feature is the predicate admitting one of the last two.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseChannelThreadReply, parseMentionEvent } from "../../../../live/listen/mention.js";
import {
  admitThreadReply,
  NO_THREAD_REPLIES,
  parseThreadReplyChannels,
  THREAD_REPLY_DAILY_CAP,
} from "../../../../live/listen/threadReply.js";

/** This install's own Slack USER id — what a thread root's author must be for the reply to be an address. */
const SELF_USER = "U0BOT";

/** The one conversation these tests have switched thread-reply addressing on for. */
const ENABLED = ["C0ALERTS"] as const;

/**
 * A human's reply under one of the bot's own posts, with per-test overrides.
 *
 * Shaped after the fields a real threaded `message` carries — `thread_ts` pointing at the root, `ts` its own,
 * and `parent_user_id` naming who wrote the root (Slack sends the same pair on a bot-authored thread message).
 */
function replyOf(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    channel: "C0ALERTS",
    channel_type: "channel",
    parent_user_id: SELF_USER,
    text: "why did the staging pool exhaust?",
    thread_ts: "1789719065.541169",
    ts: "1789719400.118200",
    type: "message",
    user: "U0HUMAN",
    ...over,
  };
}

describe("parseChannelThreadReply — the three verdicts", () => {
  it("ADMITS a reply whose thread root is one of this bot's own posts", () => {
    const mention = unwrap(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf(),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.userId).toBe("U0HUMAN");
    expect(mention.channel).toBe("C0ALERTS");
    expect(mention.surface).toBe("channel");
    expect(mention.threadTs).toBe("1789719065.541169");
    expect(mention.messageTs).toBe("1789719400.118200");
    expect(mention.text).toBe("why did the staging pool exhaust?");
  });

  it("REFUSES a reply whose thread root is a human's message", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ parent_user_id: "U0SYNSOMEONE" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("THREAD_ROOT_NOT_OURS");
    expect(error.message).toContain("started by somebody else");
  });

  it("REFUSES a top-level channel message, so nothing outside a thread ever wakes the bot", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ parent_user_id: undefined, thread_ts: undefined }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("NOT_THREAD_REPLY");
    expect(error.message).toContain("nothing top-level ever wakes it");
  });
});

describe("parseChannelThreadReply — every other refusal", () => {
  it("refuses the thread ROOT itself, which arrives with thread_ts equal to its own ts", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ thread_ts: "1789719400.118200" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("NOT_THREAD_REPLY");
    expect(error.message).toContain("IS the thread root");
  });

  it("refuses this install's OWN reply in its own thread — the self-loop with no tag needed", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ bot_id: "B0SELF", user: SELF_USER }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("SELF_AUTHORED");
    expect(error.message).toContain("loop on our own reply");
  });

  it("refuses a conversation nobody switched thread replies on for, naming it", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ channel: "C0SYNELSEWHERE" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("THREAD_REPLIES_NOT_ENABLED");
    expect(error.message).toContain("C0SYNELSEWHERE");
  });

  it("refuses every channel when no conversation is switched on, which is the default", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: [],
        event: replyOf(),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("THREAD_REPLIES_NOT_ENABLED");
  });

  it("refuses a reply carrying no parent_user_id rather than guessing the root was ours", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ parent_user_id: undefined }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("THREAD_ROOT_NOT_OURS");
    expect(error.message).toContain("no `parent_user_id`");
  });

  it("refuses every reply when auth.test never resolved this install's own user id", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf(),
        selfBotId: "B0SELF",
        selfUserId: undefined,
      }),
    );

    expect(error.code).toBe("THREAD_ROOT_NOT_OURS");
    expect(error.message).toContain("auth.test");
  });

  it("refuses an edit, which arrives as the same event with a subtype", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ subtype: "message_changed" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("HAS_SUBTYPE");
  });

  it("refuses a group DM in the words it has always been refused in", () => {
    const error = unwrapErr(
      parseChannelThreadReply({
        enabledChannels: ENABLED,
        event: replyOf({ channel_type: "mpim" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("NOT_DIRECT_MESSAGE");
  });
});

describe("parseMentionEvent routes a channel message to the thread-reply rule", () => {
  it("admits a reply under a bot post through the ONE door", () => {
    const mention = unwrap(
      parseMentionEvent({
        enabledChannels: ENABLED,
        event: replyOf(),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.channel).toBe("C0ALERTS");
  });

  it("refuses the same reply when the caller names no conversations, which is the default", () => {
    const error = unwrapErr(parseMentionEvent({ event: replyOf(), selfBotId: "B0SELF", selfUserId: SELF_USER }));

    expect(error.code).toBe("THREAD_REPLIES_NOT_ENABLED");
  });
});

describe("parseThreadReplyChannels", () => {
  it("is empty when the flag was never given, so the whole path is off", () => {
    expect(unwrap(parseThreadReplyChannels({ flag: undefined }))).toEqual([]);
  });

  it("takes a comma-separated list and deduplicates it, preserving first-seen order", () => {
    expect(unwrap(parseThreadReplyChannels({ flag: "C0ALERTS, G0SYNPRIVATE ,C0ALERTS" }))).toEqual([
      "C0ALERTS",
      "G0SYNPRIVATE",
    ]);
  });

  it("refuses a valueless flag rather than reading it as 'every channel'", () => {
    expect(unwrapErr(parseThreadReplyChannels({ flag: "" }))).toEqual([
      "--thread-replies requires a comma-separated list of conversation ids",
    ]);
  });

  it("refuses a DM id, naming it — a DM is addressed by tagging the bot", () => {
    const errors = unwrapErr(parseThreadReplyChannels({ flag: "D0OWNER" }));

    expect(errors).toEqual(["--thread-replies takes public or private channel ids (C… or G…), not D0OWNER"]);
  });
});

describe("admitThreadReply", () => {
  const CHANNEL = "C0ALERTS";
  const THREAD = "1789719065.541169";
  const NOW = "2026-09-18T09:00:00.000Z";

  it("admits the first reply of the day and counts it", () => {
    const budget = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts: NO_THREAD_REPLIES,
      nowIso: NOW,
      threadTs: THREAD,
    });

    expect(budget.admitted).toBe(true);
    expect(unwrapBudget({ budget }).answeredToday).toBe(1);
  });

  it("admits exactly the cap and refuses the one after it", () => {
    let counts = NO_THREAD_REPLIES;
    const admitted: number[] = [];
    for (let i = 0; i < THREAD_REPLY_DAILY_CAP; i += 1) {
      const budget = admitThreadReply({
        cap: THREAD_REPLY_DAILY_CAP,
        channel: CHANNEL,
        counts,
        nowIso: NOW,
        threadTs: THREAD,
      });
      counts = budget.counts;
      admitted.push(unwrapBudget({ budget }).answeredToday);
    }
    const past = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts,
      nowIso: NOW,
      threadTs: THREAD,
    });

    expect(admitted).toEqual([1, 2, 3, 4]);
    expect(past.admitted).toBe(false);
    expect(refusalOf({ budget: past })).toContain("cap of 4");
  });

  it("does NOT advance the counts on a refusal, so the number in the reason stops climbing", () => {
    let counts = NO_THREAD_REPLIES;
    for (let i = 0; i < THREAD_REPLY_DAILY_CAP; i += 1) {
      counts = admitThreadReply({
        cap: THREAD_REPLY_DAILY_CAP,
        channel: CHANNEL,
        counts,
        nowIso: NOW,
        threadTs: THREAD,
      }).counts;
    }
    const first = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts,
      nowIso: NOW,
      threadTs: THREAD,
    });
    const second = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts: first.counts,
      nowIso: NOW,
      threadTs: THREAD,
    });

    expect(refusalOf({ budget: second })).toBe(refusalOf({ budget: first }));
  });

  it("gives the same thread a fresh budget on the next UTC day", () => {
    let counts = NO_THREAD_REPLIES;
    for (let i = 0; i < THREAD_REPLY_DAILY_CAP; i += 1) {
      counts = admitThreadReply({
        cap: THREAD_REPLY_DAILY_CAP,
        channel: CHANNEL,
        counts,
        nowIso: NOW,
        threadTs: THREAD,
      }).counts;
    }
    const tomorrow = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts,
      nowIso: "2026-09-19T00:00:01.000Z",
      threadTs: THREAD,
    });

    expect(tomorrow.admitted).toBe(true);
    expect(unwrapBudget({ budget: tomorrow }).answeredToday).toBe(1);
  });

  it("budgets each THREAD separately, so one busy post cannot mute another", () => {
    let counts = NO_THREAD_REPLIES;
    for (let i = 0; i < THREAD_REPLY_DAILY_CAP; i += 1) {
      counts = admitThreadReply({
        cap: THREAD_REPLY_DAILY_CAP,
        channel: CHANNEL,
        counts,
        nowIso: NOW,
        threadTs: THREAD,
      }).counts;
    }
    const other = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: CHANNEL,
      counts,
      nowIso: NOW,
      threadTs: "1789719999.000100",
    });

    expect(other.admitted).toBe(true);
  });

  it("budgets each CHANNEL separately, so the same thread ts in two places does not collide", () => {
    let counts = NO_THREAD_REPLIES;
    for (let i = 0; i < THREAD_REPLY_DAILY_CAP; i += 1) {
      counts = admitThreadReply({
        cap: THREAD_REPLY_DAILY_CAP,
        channel: CHANNEL,
        counts,
        nowIso: NOW,
        threadTs: THREAD,
      }).counts;
    }
    const elsewhere = admitThreadReply({
      cap: THREAD_REPLY_DAILY_CAP,
      channel: "C0OTHER",
      counts,
      nowIso: NOW,
      threadTs: THREAD,
    });

    expect(elsewhere.admitted).toBe(true);
  });
});

/** The admitted arm of a budget verdict — throwing rather than branching, per the testing rules. */
function unwrapBudget({ budget }: { budget: ReturnType<typeof admitThreadReply> }): { readonly answeredToday: number } {
  if (!budget.admitted) {
    throw new Error(`expected an admitted budget, got: ${budget.why}`);
  }
  return { answeredToday: budget.answeredToday };
}

/** The refusal reason of a budget verdict — throwing rather than branching, per the testing rules. */
function refusalOf({ budget }: { budget: ReturnType<typeof admitThreadReply> }): string {
  if (budget.admitted) {
    throw new Error("expected a refused budget, got an admitted one");
  }
  return budget.why;
}
