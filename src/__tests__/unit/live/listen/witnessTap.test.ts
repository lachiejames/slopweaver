/**
 * The witness tap end to end over the REAL address loop (`consumeMentions`) and a plain fake connection — no
 * mocks. What it proves: a tag of the witnessed bot starts a silent witness, later messages in that thread
 * (the bot's own included) become `witness` lines, the address path still answers its own tags and wins any
 * overlap, a redelivery hands off once, scope still bounds it, and a throwing witness handler never ends the
 * listener.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "#lib/result.js";
import { createDedupeState } from "../../../../live/listen/dedupe.js";
import { type Mention, parseMentionEvent } from "../../../../live/listen/mention.js";
import { type ListenScope, UNSCOPED } from "../../../../live/listen/scope.js";
import { consumeMentions, type SocketConnection } from "../../../../live/listen/socket.js";
import type { WitnessHandler, WitnessLine } from "../../../../live/listen/witness.js";
import { type WitnessStateError, WitnessStateErrors } from "../../../../live/listen/witnessErrors.js";
import { emptyWitnessState, type WitnessState } from "../../../../live/listen/witnessState.js";
import { witnessGateOver } from "../../../../live/listen/witnessStateStore.js";
import { createWitnessTap, type WitnessTapPolicy, witnessingConnection } from "../../../../live/listen/witnessTap.js";

const SELF_BOT = "B0SELF";
const SELF_USER = "U0BOT";
const PEER = "U0PEER";
const ROOT = "1790000000.000100";

/** A connection over fixed frames that records every acknowledgement. */
function fakeConnection({ texts }: { texts: readonly string[] }): { connection: SocketConnection; acked: string[] } {
  const acked: string[] = [];
  const connection: SocketConnection = {
    acknowledge: ({ envelopeId }) => {
      acked.push(envelopeId);
    },
    cancel: async () => {},
    close: async () => {},
    discarded: () => 0,
    endedBecause: () => "the fixture ran out of frames",
    frames: async function* frames() {
      for (const text of texts) {
        yield text;
      }
    },
  };
  return { acked, connection };
}

/** One `events_api` frame around a raw event. */
function frame({
  envelopeId,
  event,
  eventId,
}: {
  envelopeId: string;
  event: Readonly<Record<string, unknown>>;
  eventId: string;
}): string {
  return JSON.stringify({
    envelope_id: envelopeId,
    payload: { event, event_id: eventId, type: "event_callback" },
    type: "events_api",
  });
}

/** A channel `message` event. */
function channelMessage(over: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { channel: "C0OPS", channel_type: "channel", type: "message", user: "U0HUMAN", ...over };
}

/** Drive the address loop over the tapped connection, recording both handlers' output. */
async function run({
  save = () => ok(undefined),
  scope = UNSCOPED,
  stoodDown = () => ok(false),
  texts,
  witnessHandler,
  witnessUserIds = [PEER],
}: {
  save?: (args: { state: WitnessState }) => Result<void, WitnessStateError>;
  scope?: ListenScope;
  stoodDown?: WitnessTapPolicy["stoodDown"];
  texts: readonly string[];
  witnessHandler?: WitnessHandler;
  witnessUserIds?: readonly string[];
}): Promise<{ acked: string[]; lines: WitnessLine[]; log: string[]; mentions: Mention[] }> {
  const lines: WitnessLine[] = [];
  const log: string[] = [];
  const mentions: Mention[] = [];
  const fake = fakeConnection({ texts });
  const recordLine: WitnessHandler = async (line) => {
    lines.push(line);
  };
  let handler = recordLine;
  if (witnessHandler !== undefined) {
    handler = witnessHandler;
  }
  const tap = createWitnessTap({
    policy: {
      gate: witnessGateOver({ initial: emptyWitnessState(), now: () => 1_790_000_000_000, save }),
      handler,
      isAddress: ({ event }) => parseMentionEvent({ event, selfBotId: SELF_BOT, selfUserId: SELF_USER }).isOk(),
      log: ({ line }) => log.push(line),
      scope,
      selfBotId: SELF_BOT,
      selfUserId: SELF_USER,
      stoodDown,
      witnessUserIds,
    },
  });
  await consumeMentions({
    connection: witnessingConnection({ connection: fake.connection, tap }),
    handler: async (mention) => {
      mentions.push(mention);
    },
    log: ({ line }) => log.push(line),
    refuseResponder: async () => {},
    responderHatchOpen: () => false,
    responderWhitelist: () => ({ identities: ["U0HUMAN"], kind: "list" }),
    scope,
    seen: createDedupeState(),
    selfBotId: SELF_BOT,
    selfUserId: SELF_USER,
  });
  return { acked: fake.acked, lines, log, mentions };
}

const TAG_PEER = frame({
  envelopeId: "e-1",
  event: channelMessage({ text: `<@${PEER}> booking sync failing for a customer`, ts: ROOT }),
  eventId: "Ev1",
});
const PEER_REPLY = frame({
  envelopeId: "e-2",
  event: channelMessage({
    app_id: "A0PEER",
    bot_id: "B0PEER",
    text: "Retried — resolved.",
    thread_ts: ROOT,
    ts: "1790000060.000100",
    user: PEER,
  }),
  eventId: "Ev2",
});

describe("the witness tap over the address loop", () => {
  it("witnesses the tag and the peer bot's reply, acknowledging both, with no address", async () => {
    const result = await run({ texts: [TAG_PEER, PEER_REPLY] });

    expect(result.acked).toEqual(["e-1", "e-2"]);
    expect(result.mentions).toEqual([]);
    expect(result.lines).toEqual([
      {
        activation: true,
        channel: "C0OPS",
        kind: "witness",
        messageTs: ROOT,
        ownThread: false,
        text: `@(${PEER}) booking sync failing for a customer`,
        threadTs: ROOT,
        userId: "U0HUMAN",
        witnessUserId: PEER,
      },
      {
        activation: false,
        channel: "C0OPS",
        kind: "witness",
        messageTs: "1790000060.000100",
        ownThread: false,
        text: "Retried — resolved.",
        threadTs: ROOT,
        userId: PEER,
        witnessUserId: PEER,
      },
    ]);
  });

  it("answers a tag of this bot, then hands the thread's later untagged messages off as ownThread lines", async () => {
    const ask = `<@${SELF_USER}> local e2e is failing on the user limit`;
    const appMention = frame({
      envelopeId: "e-1a",
      event: { channel: "C0OPS", text: ask, ts: ROOT, type: "app_mention", user: "U0HUMAN" },
      eventId: "Ev1a",
    });
    const message = frame({ envelopeId: "e-1b", event: channelMessage({ text: ask, ts: ROOT }), eventId: "Ev1b" });
    const offer = frame({
      envelopeId: "e-3",
      event: channelMessage({ text: "anything I can do to assist?", thread_ts: ROOT, ts: "1790000120.000100" }),
      eventId: "Ev3",
    });
    const result = await run({ texts: [appMention, message, offer], witnessUserIds: [] });

    expect(result.mentions.map((mention) => mention.messageTs)).toEqual([ROOT]);
    expect(result.lines).toEqual([
      {
        activation: false,
        channel: "C0OPS",
        kind: "witness",
        messageTs: "1790000120.000100",
        ownThread: true,
        text: "anything I can do to assist?",
        threadTs: ROOT,
        userId: "U0HUMAN",
      },
    ]);
  });

  it("still answers a tag in a thread the bot stood down in, and hands none of its other messages off", async () => {
    const ask = `<@${SELF_USER}> so which region is it in now?`;
    const appMention = frame({
      envelopeId: "e-1a",
      event: { channel: "C0OPS", text: ask, ts: ROOT, type: "app_mention", user: "U0HUMAN" },
      eventId: "Ev1a",
    });
    const message = frame({ envelopeId: "e-1b", event: channelMessage({ text: ask, ts: ROOT }), eventId: "Ev1b" });
    const aside = frame({
      envelopeId: "e-3",
      event: channelMessage({ text: "we moved it to Melbourne", thread_ts: ROOT, ts: "1790000120.000100" }),
      eventId: "Ev3",
    });
    const asked: string[] = [];
    const result = await run({
      stoodDown: ({ channel, threadTs }) => {
        asked.push(`${channel}/${threadTs}`);
        return ok(true);
      },
      texts: [appMention, message, aside, PEER_REPLY],
    });

    expect(result.mentions.map((mention) => mention.messageTs)).toEqual([ROOT]);
    expect(result.lines).toEqual([]);
    expect(asked).toEqual([`C0OPS/${ROOT}`, `C0OPS/${ROOT}`]);
    expect(result.log).toContain("witness: not handed off C0OPS/1790000120.000100 — the bot stood down there");
  });

  it("hands nothing off while the witness journal cannot say whether the thread stood down", async () => {
    const result = await run({ stoodDown: () => err("EACCES"), texts: [TAG_PEER, PEER_REPLY] });

    expect(result.lines).toEqual([]);
    expect(result.log).toContain(
      `witness: not handed off C0OPS/${ROOT} — the witness journal could not be read (EACCES)`,
    );
  });

  it("hands nothing off for a thread nobody tagged the witnessed bot in", async () => {
    const result = await run({ texts: [PEER_REPLY] });

    expect(result.lines).toEqual([]);
  });

  it("lets the address path answer a message tagging both bots, and still starts witnessing its thread", async () => {
    const both = `<@${SELF_USER}> <@${PEER}> is this really fixed?`;
    const appMention = frame({
      envelopeId: "e-1a",
      event: { channel: "C0OPS", text: both, ts: ROOT, type: "app_mention", user: "U0HUMAN" },
      eventId: "Ev1a",
    });
    const message = frame({ envelopeId: "e-1b", event: channelMessage({ text: both, ts: ROOT }), eventId: "Ev1b" });
    const result = await run({ texts: [appMention, message, PEER_REPLY] });

    expect(result.mentions.map((mention) => mention.messageTs)).toEqual([ROOT]);
    expect(result.lines.map((line) => line.messageTs)).toEqual(["1790000060.000100"]);
  });

  it("hands a redelivered message off once", async () => {
    const redelivered = frame({
      envelopeId: "e-2-retry",
      event: channelMessage({ text: "Retried — resolved.", thread_ts: ROOT, ts: "1790000060.000100", user: PEER }),
      eventId: "Ev2",
    });
    const result = await run({ texts: [TAG_PEER, PEER_REPLY, redelivered] });

    expect(result.lines.map((line) => line.messageTs)).toEqual([ROOT, "1790000060.000100"]);
  });

  it("hands one message off once though a second event names it under a different event id", async () => {
    const secondEvent = frame({
      envelopeId: "e-2b",
      event: channelMessage({ text: "Retried — resolved.", thread_ts: ROOT, ts: "1790000060.000100", user: PEER }),
      eventId: "Ev2b",
    });
    const result = await run({ texts: [TAG_PEER, PEER_REPLY, secondEvent] });

    expect(result.acked).toEqual(["e-1", "e-2", "e-2b"]);
    expect(result.lines.map((line) => line.messageTs)).toEqual([ROOT, "1790000060.000100"]);
  });

  it("judges a redelivery afresh when the first delivery's state could not be saved", async () => {
    let saves = 0;
    const failFirst = (): Result<void, WitnessStateError> => {
      saves += 1;
      return saves === 1 ? err(WitnessStateErrors.writeFailed({ cause: "disk full", path: "/w.json" })) : ok(undefined);
    };
    const redelivered = frame({
      envelopeId: "e-1-retry",
      event: channelMessage({ text: `<@${PEER}> booking sync failing for a customer`, ts: ROOT }),
      eventId: "Ev1",
    });
    const result = await run({ save: failFirst, texts: [TAG_PEER, redelivered] });

    expect(result.lines.map((line) => line.messageTs)).toEqual([ROOT]);
    expect(result.log.some((line) => line.includes("a redelivery is judged afresh"))).toBe(true);
  });

  it("witnesses nothing in a conversation outside the listener's scope", async () => {
    const result = await run({
      scope: { channels: ["C0SYNELSEWHERE"], kind: "channels" },
      texts: [TAG_PEER, PEER_REPLY],
    });

    expect(result.lines).toEqual([]);
  });

  it("keeps listening after a witness handler throws", async () => {
    const seen: string[] = [];
    const result = await run({
      texts: [TAG_PEER, PEER_REPLY],
      witnessHandler: async (line) => {
        seen.push(line.messageTs);
        if (line.activation) {
          throw new Error("queue file unwritable");
        }
      },
    });

    expect(seen).toEqual([ROOT, "1790000060.000100"]);
    expect(result.log.some((line) => line.includes("the witness handler threw"))).toBe(true);
  });
});
