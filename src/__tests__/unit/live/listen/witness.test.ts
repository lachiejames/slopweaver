/**
 * Reading a raw event as a witness candidate: a peer bot's own messages ARE read (they are the claims), this
 * install's own are not, and every non-message shape is skipped by name.
 */
import { describe, expect, it } from "vitest";

import { parseWitnessEvent, type WitnessParse } from "../../../../live/listen/witness.js";

const SELF_BOT = "B0SELF";
const SELF_USER = "U0SELF";
const PEER = "U0PEER";

/** A channel message event, Helpbot's measured shape by default overridden per case. */
function event(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    channel: "C0OPS",
    channel_type: "channel",
    text: "retried the sync, the customer can book now",
    thread_ts: "1790000000.000100",
    ts: "1790000060.000100",
    type: "message",
    user: "U0HUMAN",
    ...over,
  };
}

/** Parse with the standard identities. */
function parse({
  eventType = "message",
  raw,
  witnessUserIds = [PEER],
}: {
  eventType?: string;
  raw: Readonly<Record<string, unknown>>;
  witnessUserIds?: readonly string[];
}): WitnessParse {
  return parseWitnessEvent({ event: raw, eventType, selfBotId: SELF_BOT, selfUserId: SELF_USER, witnessUserIds });
}

describe("parseWitnessEvent", () => {
  it("reads a person's thread reply, threaded on its root, with no activation", () => {
    expect(parse({ raw: event() })).toEqual({
      candidate: {
        activatesFor: undefined,
        channel: "C0OPS",
        messageTs: "1790000060.000100",
        tagsSelf: false,
        text: "retried the sync, the customer can book now",
        threadTs: "1790000000.000100",
        userId: "U0HUMAN",
      },
      kind: "candidate",
    });
  });

  it("marks a tag of THIS bot — the own watch's activation — with no peer activation", () => {
    const parsed = parse({ raw: event({ text: `<@${SELF_USER}> is the local e2e fix in?` }) });

    expect(parsed).toMatchObject({ candidate: { activatesFor: undefined, tagsSelf: true }, kind: "candidate" });
  });

  it("never lets a peer bot's tag of THIS bot open an own watch — only a person asks the bot in", () => {
    const echoed = `cc <@${SELF_USER}>`;
    const peer = parse({ raw: event({ app_id: "A0PEER", bot_id: "B0PEER", text: echoed, user: PEER }) });
    const botMessage = parse({
      raw: event({ bot_id: "B0PEERBOT", subtype: "bot_message", text: echoed, user: undefined }),
    });

    expect(peer).toMatchObject({ candidate: { tagsSelf: false, userId: PEER }, kind: "candidate" });
    expect(botMessage).toMatchObject({ candidate: { tagsSelf: false, userId: "B0PEERBOT" }, kind: "candidate" });
  });

  it("reads candidates for the own watch alone when no peer bot is configured", () => {
    expect(parse({ raw: event(), witnessUserIds: [] }).kind).toBe("candidate");
  });

  it("skips everything when there is no peer bot and this bot's own id is unknown", () => {
    const parsed = parseWitnessEvent({
      event: event(),
      eventType: "message",
      selfBotId: SELF_BOT,
      selfUserId: undefined,
      witnessUserIds: [],
    });

    expect(parsed).toEqual({ kind: "skip", reason: "nothing-to-witness" });
  });

  it("activates on a top-level tag of the witnessed bot, threading on the message itself", () => {
    const parsed = parse({ raw: event({ text: `<@${PEER}> the booking sync is failing`, thread_ts: undefined }) });

    expect(parsed).toEqual({
      candidate: {
        activatesFor: PEER,
        channel: "C0OPS",
        messageTs: "1790000060.000100",
        tagsSelf: false,
        text: `@(${PEER}) the booking sync is failing`,
        threadTs: "1790000060.000100",
        userId: "U0HUMAN",
      },
      kind: "candidate",
    });
  });

  it("reads the witnessed bot's own message — user, bot_id and app_id, no subtype", () => {
    const parsed = parse({ raw: event({ app_id: "A0PEER", bot_id: "B0PEER", text: "Resolved.", user: PEER }) });

    expect(parsed.kind).toBe("candidate");
    expect(parsed).toMatchObject({ candidate: { text: "Resolved.", userId: PEER } });
  });

  it("reads a bot_message with no user, authored by its B-shaped bot_id", () => {
    const parsed = parse({ raw: event({ bot_id: "B0PEERBOT", subtype: "bot_message", user: undefined }) });

    expect(parsed).toMatchObject({ candidate: { userId: "B0PEERBOT" }, kind: "candidate" });
  });

  it("skips every bot post while this install's own bot_id is unknown, as the address path does", () => {
    const parsed = parseWitnessEvent({
      event: event({ bot_id: "B0PEERBOT" }),
      eventType: "message",
      selfBotId: undefined,
      selfUserId: SELF_USER,
      witnessUserIds: [PEER],
    });

    expect(parsed).toEqual({ kind: "skip", reason: "self-authored" });
  });

  it("reads a reply also sent to the channel", () => {
    expect(parse({ raw: event({ subtype: "thread_broadcast" }) }).kind).toBe("candidate");
  });

  it.each([
    ["an app_mention envelope", { eventType: "app_mention", raw: event({ type: "app_mention" }) }, "not-a-message"],
    ["a direct message", { raw: event({ channel_type: "im" }) }, "not-a-channel"],
    ["an edit", { raw: event({ subtype: "message_changed" }) }, "has-subtype"],
    ["a channel join", { raw: event({ subtype: "channel_join" }) }, "has-subtype"],
    ["this install's own post", { raw: event({ bot_id: SELF_BOT }) }, "self-authored"],
    ["an app_id-only post", { raw: event({ app_id: "A0SYNSOMEONE" }) }, "self-authored"],
    ["a message with no ts", { raw: event({ ts: undefined }) }, "missing-fields"],
  ] as const)("skips %s by name", (_label, input, reason) => {
    expect(parse(input)).toEqual({ kind: "skip", reason });
  });
});
