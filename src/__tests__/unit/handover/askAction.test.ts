import { describe, expect, it } from "vitest";

import { WHAT_MAX_WORDS } from "../../../briefing/caps.js";
import {
  ACTION_BODY_MAX_CHARS,
  ACTION_BODY_MAX_LINES,
  ACTION_BODY_MAX_WORDS,
  ACTION_MAX_DESTINATIONS,
  ACTION_MAX_FOLLOW_UPS,
  ACTION_MAX_MENTIONS,
  type AskAction,
  type AskDestination,
  actionMessages,
  activeMentionIds,
  askActionProblems,
  type SlackAskAction,
} from "../../../handover/askAction.js";
import { ACTION_LABEL_MAX_CHARS, destinationKey } from "../../../handover/askActionDestination.js";

/** The channel every well-formed case posts to. */
const SDLC: AskDestination = {
  channel: "C01SDLC",
  kind: "channel",
  label: "Post it to #delivery",
  tradeoff: "the whole channel sees we are asking, and two of them are on leave",
};

/** A well-formed action: one tagged person, one place to send it. */
const WHOLE: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review — one approval and it lands tonight.",
  destinations: [SDLC],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

describe("askActionProblems", () => {
  it("passes a whole, in-caps action with nothing to say", () => {
    expect(askActionProblems({ action: WHOLE })).toEqual([]);
  });

  it("refuses an empty draft, and says nothing else about it", () => {
    expect(askActionProblems({ action: { ...WHOLE, body: "   \n  ", mentions: [] } })).toEqual([
      "the drafted message is empty — an action the owner cannot read is not an action",
    ]);
  });

  it("names the word count and the cap on an over-long draft", () => {
    const long = Array.from({ length: ACTION_BODY_MAX_WORDS + 1 }, () => "word").join(" ");
    expect(askActionProblems({ action: { ...WHOLE, body: long, mentions: [] } })).toEqual([
      `the drafted message runs ${String(ACTION_BODY_MAX_WORDS + 1)} words against a cap of ` +
        `${String(ACTION_BODY_MAX_WORDS)} — ` +
        "the card shows what would really be posted, so shortening it here shortens the post",
    ]);
  });

  it("gives the word cap 80 percent more room than the briefing's own above-the-fold budget", () => {
    expect(WHAT_MAX_WORDS).toBe(60);
    expect(ACTION_BODY_MAX_WORDS).toBe(108);
  });

  it("catches a paste the word cap cannot see, by characters", () => {
    const pasted = `see ${"x".repeat(ACTION_BODY_MAX_CHARS)}`;
    const problems = askActionProblems({ action: { ...WHOLE, body: pasted, mentions: [] } });
    expect(problems).toEqual([
      `the drafted message runs ${String(pasted.length)} characters against a cap of ` +
        `${String(ACTION_BODY_MAX_CHARS)}`,
    ]);
  });

  it("names the line count and the cap on a draft that is a document", () => {
    const many = Array.from({ length: ACTION_BODY_MAX_LINES + 1 }, () => "line").join("\n");
    expect(askActionProblems({ action: { ...WHOLE, body: many, mentions: [] } })).toEqual([
      `the drafted message runs ${String(ACTION_BODY_MAX_LINES + 1)} lines against a cap of ` +
        `${String(ACTION_BODY_MAX_LINES)}`,
    ]);
  });

  it("refuses a body that tags somebody the action does not name", () => {
    expect(askActionProblems({ action: { ...WHOLE, mentions: [] } })).toEqual([
      "the drafted message tags U01ARI and the action does not name them — the card would understate it",
    ]);
  });

  it("refuses an action naming somebody the body does not tag", () => {
    const action = { ...WHOLE, mentions: [...WHOLE.mentions, { label: "Tobias", userId: "U01TOB" }] };
    expect(askActionProblems({ action })).toEqual([
      "the action names U01TOB and the drafted message does not tag them — the card would overstate it",
    ]);
  });

  it("does not count a mention inside a code span, because Slack notifies nobody for one", () => {
    const action: AskAction = { ...WHOLE, body: "use `<@U01ARI>` as the token", mentions: [] };
    expect(askActionProblems({ action })).toEqual([]);
  });

  it("refuses an action with nowhere to send it", () => {
    expect(askActionProblems({ action: { ...WHOLE, destinations: [] } })).toEqual([
      "the action offers nowhere to send it — a draft with no destination is not a decision",
    ]);
  });

  it("names the destination count, the cap and the hold that eats the fourth slot", () => {
    const four: readonly AskDestination[] = Array.from(
      { length: ACTION_MAX_DESTINATIONS + 1 },
      (_unused, index): AskDestination => ({ ...SDLC, channel: `C0${String(index)}SDLC` }),
    );
    expect(askActionProblems({ action: { ...WHOLE, destinations: four } })).toEqual([
      `the action offers ${String(ACTION_MAX_DESTINATIONS + 1)} destinations against a cap of ` +
        `${String(ACTION_MAX_DESTINATIONS)}, because the card draws HOLD beside them`,
    ]);
  });

  it("refuses the same place offered twice", () => {
    expect(askActionProblems({ action: { ...WHOLE, destinations: [SDLC, { ...SDLC }] } })).toEqual([
      "Post it to #delivery is offered twice — two options that do the same thing are one option",
    ]);
  });

  it("lets a channel and a thread inside it stand as two places", () => {
    const thread: AskDestination = {
      channel: SDLC.channel,
      kind: "thread",
      label: "Reply in the thread",
      threadTs: "1758500000.000100",
      tradeoff: "only the people already in the thread see it",
    };
    expect(askActionProblems({ action: { ...WHOLE, destinations: [SDLC, thread] } })).toEqual([]);
  });

  it("refuses an id the send verb could not reach", () => {
    expect(askActionProblems({ action: { ...WHOLE, destinations: [{ ...SDLC, channel: "#delivery" }] } })).toEqual([
      "#delivery is not a Slack conversation id — the card links and the verb posts by id",
    ]);
  });

  it("refuses a thread root that is an instant rather than a ts", () => {
    const thread: AskDestination = {
      channel: "C01SDLC",
      kind: "thread",
      label: "Reply in the thread",
      threadTs: "2026-09-22T12:00:00.000Z",
      tradeoff: "only the people already in the thread see it",
    };
    expect(askActionProblems({ action: { ...WHOLE, destinations: [thread] } })).toEqual([
      "2026-09-22T12:00:00.000Z is not a Slack ts — a reply binds to the thread root by its own id",
    ]);
  });

  it("refuses a DM into a conversation nothing has opened", () => {
    const dm: AskDestination = {
      conversation: "U01ARI",
      kind: "dm",
      label: "DM Ari",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "only Ari sees it, so nobody else can pick it up",
    };
    expect(askActionProblems({ action: { ...WHOLE, destinations: [dm] } })).toEqual([
      "U01ARI is not an open Slack conversation — " +
        "`slopweaver slack dm open --with <people>` is what opens one, and a preview never does",
    ]);
  });

  it("refuses a destination that names no trade-off", () => {
    expect(askActionProblems({ action: { ...WHOLE, destinations: [{ ...SDLC, tradeoff: "  " }] } })).toEqual([
      "the channel carries no trade-off — every option on a card says what it costs",
    ]);
  });

  it("refuses a destination label the card could not fit on one line", () => {
    const label = "x".repeat(ACTION_LABEL_MAX_CHARS + 1);
    expect(askActionProblems({ action: { ...WHOLE, destinations: [{ ...SDLC, label }] } })).toEqual([
      `the channel's label runs ${String(ACTION_LABEL_MAX_CHARS + 1)} characters against a cap of ` +
        `${String(ACTION_LABEL_MAX_CHARS)} — it sits on one line of the card`,
    ]);
  });

  it("refuses more mentions than the preview's row holds, before anything else about them", () => {
    const people = Array.from({ length: ACTION_MAX_MENTIONS + 1 }, (_unused, index) => ({
      label: `Person ${String(index)}`,
      userId: `U0${String(index)}MENTION`,
    }));
    const body = people.map((one) => `<@${one.userId}>`).join(" ");
    const problems = askActionProblems({ action: { ...WHOLE, body, mentions: people } });
    expect(problems).toEqual([
      `the drafted message tags ${String(ACTION_MAX_MENTIONS + 1)} people against a cap of ` +
        `${String(ACTION_MAX_MENTIONS)}`,
    ]);
  });
});

describe("askActionProblems — a draft sent in parts", () => {
  /** A thread a draft replies in, where the owner drips across short replies. */
  const THREAD: AskDestination = {
    channel: "C01ISO",
    kind: "thread",
    label: "Reply to Rosa in the ISO thread",
    threadTs: "1758900000.000100",
    tradeoff: "only the people already in the thread see it",
  };
  const PARTS: SlackAskAction = {
    actor: "me",
    body: "<@U01ROSA> to clarify my angle: the pull request is a place to show the evidence, not a change.",
    destinations: [THREAD],
    followUps: ["In addition to that one, here is a second example doing the same thing."],
    mentions: [{ label: "Rosa", userId: "U01ROSA" }],
    version: 1,
  };

  it("passes two messages to one thread", () => {
    expect(askActionProblems({ action: PARTS })).toEqual([]);
  });

  it("sends the body first and each follow-up after it, in order", () => {
    expect(actionMessages({ action: { ...PARTS, followUps: ["second", "third"] } })).toEqual([
      PARTS.body,
      "second",
      "third",
    ]);
  });

  it("is the body alone when the action records no follow-up", () => {
    const one: SlackAskAction = {
      actor: "me",
      body: PARTS.body,
      destinations: PARTS.destinations,
      mentions: PARTS.mentions,
      version: 1,
    };
    expect(actionMessages({ action: one })).toEqual([PARTS.body]);
  });

  it("refuses a recorded follow-up list that is empty, so the wire has one spelling of one message", () => {
    expect(askActionProblems({ action: { ...PARTS, followUps: [] } })).toEqual([
      "the action records an empty follow-up list — omit the field when there is one message",
    ]);
  });

  it("names the follow-up count and the cap past which it is a thread of its own", () => {
    const many = Array.from({ length: ACTION_MAX_FOLLOW_UPS + 1 }, (_unused, index) => `part ${String(index)}`);
    expect(askActionProblems({ action: { ...PARTS, followUps: many } })).toEqual([
      `the action sends ${String(ACTION_MAX_FOLLOW_UPS + 1)} follow-ups against a cap of ` +
        `${String(ACTION_MAX_FOLLOW_UPS)} — past that it is a thread of its own, not a reply`,
    ]);
  });

  it("caps each follow-up as a message of its own, naming which one broke", () => {
    const many = Array.from({ length: ACTION_BODY_MAX_LINES + 1 }, () => "line").join("\n");
    expect(askActionProblems({ action: { ...PARTS, followUps: ["fine", many] } })).toEqual([
      `follow-up 2: the drafted message runs ${String(ACTION_BODY_MAX_LINES + 1)} lines against a cap of ` +
        `${String(ACTION_BODY_MAX_LINES)}`,
    ]);
  });

  it("refuses a blank follow-up as an empty message", () => {
    expect(askActionProblems({ action: { ...PARTS, followUps: ["  "] } })).toEqual([
      "follow-up 1: the drafted message is empty — an action the owner cannot read is not an action",
    ]);
  });

  it("counts a tag in a follow-up as a mention the action must name", () => {
    const action: AskAction = { ...PARTS, followUps: ["and <@U01TOB> for the second example"] };
    expect(askActionProblems({ action })).toEqual([
      "the drafted message tags U01TOB and the action does not name them — the card would understate it",
    ]);
  });

  it("accepts a person named once and tagged only in a follow-up", () => {
    const action: AskAction = {
      ...PARTS,
      body: "to clarify my angle: the pull request is a place to show the evidence.",
      followUps: ["<@U01ROSA> and a second example."],
    };
    expect(askActionProblems({ action })).toEqual([]);
  });

  it("refuses follow-ups beside a channel destination, because that is several top-level posts", () => {
    const action: AskAction = { ...PARTS, destinations: [THREAD, SDLC] };
    expect(askActionProblems({ action })).toEqual([
      "Post it to #delivery is a new top-level message, and follow-ups there would be several top-level posts — " +
        "offer a thread or a DM for a message that goes out in parts",
    ]);
  });
});

describe("activeMentionIds", () => {
  it("reads every tag once, in the order the body spells them", () => {
    const body = "<@U01B> then <@U01A> then <@U01B> again";
    expect(activeMentionIds({ body })).toEqual(["U01B", "U01A"]);
  });

  it("ignores a tag inside a fenced block and one inside backticks", () => {
    const body = "```\n<@U0SYN1FENCED>\n```\nand `<@U0SYN1TICKED>` but <@U01REAL> is real";
    expect(activeMentionIds({ body })).toEqual(["U01REAL"]);
  });

  it("reads a workspace-scoped W id the same as a U id", () => {
    expect(activeMentionIds({ body: "<@W01ARI>" })).toEqual(["W01ARI"]);
  });

  it("finds nothing in a body that tags nobody", () => {
    expect(activeMentionIds({ body: "no tags here at all" })).toEqual([]);
  });
});

describe("destinationKey", () => {
  it("tells a channel apart from a thread in the same channel", () => {
    const thread: AskDestination = {
      channel: "C01SDLC",
      kind: "thread",
      label: "Reply in the thread",
      threadTs: "1758500000.000100",
      tradeoff: "only the thread sees it",
    };
    expect(destinationKey({ destination: SDLC })).toBe("channel:C01SDLC");
    expect(destinationKey({ destination: thread })).toBe("thread:C01SDLC:1758500000.000100");
  });

  it("keys a DM by the conversation, never by who is in it", () => {
    const dm: AskDestination = {
      conversation: "D01ARI",
      kind: "dm",
      label: "DM Ari",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "only Ari sees it",
    };
    expect(destinationKey({ destination: dm })).toBe("dm:D01ARI");
  });
});
