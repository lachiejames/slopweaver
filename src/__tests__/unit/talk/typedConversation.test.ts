/*
 * What the owner typed since their last call, as the conversation a call continues. Texting an assistant where to
 * meet and then ringing them, a person expects the assistant to still know. Each case pins one
 * thing that makes the typed half the SAME conversation: both routes, oldest first, each with its answer, from where
 * the last call stopped — and never a claim to be everything when part of it was not read.
 */
import { describe, expect, it } from "vitest";

import type { ContinuitySteer, TalkContinuity } from "../../../talk/continuity.js";
import type { ContinuityCall } from "../../../talk/continuityCalls.js";
import type { SupervisorExchange, SupervisorWindow } from "../../../talk/supervisorWindow.js";
import {
  consoleReplyOf,
  TYPED_CONVERSATION_BYTES,
  typedConversationLines,
  typedConversationOf,
  typedReadFloorLines,
} from "../../../talk/typedConversation.js";

const SINCE = "2026-10-01T09:00:00.000Z";
const CALL_OPEN = "2026-10-03T08:50:00.000Z";

/** A call that has spoken, opening at {@link CALL_OPEN} and ending at 09:00. */
const call = (over: Partial<ContinuityCall> = {}): ContinuityCall => ({
  callId: "c-1",
  end: "the owner hung up",
  lastIso: "2026-10-03T09:00:00.000Z",
  lines: [{ atIso: "2026-10-03T08:59:00.000Z", final: true, text: "bye", who: "owner" }],
  linesCut: 0,
  openedIso: CALL_OPEN,
  reading: undefined,
  skipped: 0,
  ...over,
});

/** A console steer the owner typed, overridable. */
const steer = (over: Partial<ContinuitySteer> = {}): ContinuitySteer => ({
  atIso: "2026-10-03T09:10:00.000Z",
  delivery: { detail: "typed", kind: "typed" },
  heard: "we meet at the cafe at 3pm",
  outcome: { lastAction: undefined, marks: [], rowPresent: true, settlement: undefined },
  reachedChat: true,
  slug: "talk-aaaa11112222",
  turnId: "t-1",
  typed: true,
  words: "",
  ...over,
});

/** A read, overridable. */
const continuity = (over: Partial<TalkContinuity> = {}): TalkContinuity => ({
  builtIso: "2026-10-03T10:00:00.000Z",
  calls: [],
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [],
  typed: [],
  unread: [],
  ...over,
});

/** One supervisor-chat turn. */
const exchange = (over: Partial<SupervisorExchange>): SupervisorExchange => ({
  atIso: "2026-10-03T09:10:05.000Z",
  cut: false,
  text: "",
  viaVoice: false,
  who: "owner",
  ...over,
});

/** A chat read whole, newest first. */
const chat = ({ exchanges }: { exchanges: readonly SupervisorExchange[] }): SupervisorWindow => ({
  exchanges,
  note: "",
  omitted: 0,
  sessionId: "s",
  tailCut: false,
  undecodable: 0,
});

/** The chat as the relay of {@link steer} left it, answered. */
const answered = chat({
  exchanges: [
    exchange({ atIso: "2026-10-03T09:10:30.000Z", text: "Noted — the cafe at 3pm.", who: "chair" }),
    exchange({ text: '[voice relay talk-aaaa11112222] the owner typed on the console: "we meet …"', viaVoice: true }),
  ],
});

describe("consoleReplyOf", () => {
  it("is the chair's next turn after the line the relay typed in", () => {
    expect(consoleReplyOf({ slug: "talk-aaaa11112222", window: answered })).toEqual({
      atIso: "2026-10-03T09:10:30.000Z",
      text: "Noted — the cafe at 3pm.",
    });
  });

  it("is absent when the chair has not answered — never the owner's own next turn", () => {
    const window = chat({
      exchanges: [
        exchange({ atIso: "2026-10-03T09:11:00.000Z", text: "and bring the deck" }),
        exchange({ text: "[voice relay talk-aaaa11112222] the owner typed …", viaVoice: true }),
      ],
    });
    expect(consoleReplyOf({ slug: "talk-aaaa11112222", window })).toBe(undefined);
  });

  it("is absent when the relay's line is not in the window", () => {
    expect(consoleReplyOf({ slug: "talk-bbbb", window: answered })).toBe(undefined);
  });
});

describe("typedConversationOf", () => {
  it("merges both routes since the owner's last call, oldest first, each with its answer", () => {
    const read = continuity({
      calls: [call()],
      steers: [steer()],
      typed: [
        { atIso: "2026-10-03T09:20:00.000Z", reply: undefined, text: "and bring the deck" },
        { atIso: "2026-10-03T08:40:00.000Z", reply: undefined, text: "said before the call" },
      ],
    });
    expect(typedConversationOf({ continuity: read, window: answered })).toEqual({
      afterCall: true,
      cut: 0,
      floorPartial: false,
      partial: false,
      sinceIso: CALL_OPEN,
      turns: [
        {
          atIso: "2026-10-03T09:10:00.000Z",
          reply: { atIso: "2026-10-03T09:10:30.000Z", text: "Noted — the cafe at 3pm." },
          text: "we meet at the cafe at 3pm",
          via: "console",
        },
        { atIso: "2026-10-03T09:20:00.000Z", reply: undefined, text: "and bring the deck", via: "chair" },
      ],
    });
  });

  // A turn stamped in the call's opening millisecond came after its mint, so it is still unsaid to it.
  it("keeps a turn at the call's own opening instant, and leaves out one a millisecond before", () => {
    const read = continuity({
      calls: [call()],
      typed: [
        { atIso: CALL_OPEN, reply: undefined, text: "at" },
        { atIso: "2026-10-03T08:49:59.999Z", reply: undefined, text: "before" },
      ],
    });
    expect(typedConversationOf({ continuity: read, window: undefined }).turns.map((turn) => turn.text)).toEqual(["at"]);
  });

  // A call that opened before the window was read from the window's floor, so that floor is said.
  it("keeps the window's floor, and says so, when the owner's last call opened before it", () => {
    const read = continuity({ calls: [call({ openedIso: "2026-10-01T08:30:00.000Z" })] });
    const conversation = typedConversationOf({ continuity: read, window: undefined });
    expect(conversation.sinceIso).toBe(SINCE);
    expect(conversation.afterCall).toBe(false);
    expect(typedReadFloorLines({ conversation })).toEqual([
      `What the owner typed is read back only to ${SINCE}, not to their last call's opening, so anything they`,
      "typed before then is not here — delegate if they refer to it.",
    ]);
  });

  // A torn line may have been the call's opening, so that opening is not trusted as the floor.
  it("keeps the window's floor, and says so, when the owner's last call's file has a line that did not parse", () => {
    const conversation = typedConversationOf({
      continuity: continuity({ calls: [call({ skipped: 1 })] }),
      window: undefined,
    });
    expect(conversation.sinceIso).toBe(SINCE);
    expect(conversation.afterCall).toBe(false);
  });

  // Typing while a call is live never reaches that call, so the next one carries it.
  it("carries a turn the owner typed while their last call ran", () => {
    const read = continuity({
      calls: [call()],
      typed: [{ atIso: "2026-10-03T08:55:00.000Z", reply: undefined, text: "typed mid-call" }],
    });
    expect(typedConversationOf({ continuity: read, window: undefined }).turns.map((turn) => turn.text)).toEqual([
      "typed mid-call",
    ]);
  });

  // The call being minted may already have written its open line; it has said nothing, so it is not the owner's last call.
  it("reads past a call that has written no line, to the last one that spoke", () => {
    const minting = call({ callId: "c-2", lastIso: "2026-10-03T10:00:00.000Z", lines: [] });
    const read = continuity({
      calls: [minting, call()],
      typed: [{ atIso: "2026-10-03T09:30:00.000Z", reply: undefined, text: "typed between" }],
    });
    const conversation = typedConversationOf({ continuity: read, window: undefined });
    expect(conversation.sinceIso).toBe(CALL_OPEN);
    expect(conversation.turns.map((turn) => turn.text)).toEqual(["typed between"]);
  });

  it("reads from the window's floor when no call has spoken", () => {
    const conversation = typedConversationOf({
      continuity: continuity({ typed: [{ atIso: "2026-10-02T00:00:00.000Z", reply: undefined, text: "x" }] }),
      window: undefined,
    });
    expect(conversation.afterCall).toBe(false);
    expect(conversation.sinceIso).toBe(SINCE);
    expect(conversation.turns.length).toBe(1);
  });

  it("never carries a spoken steer — the call already holds it", () => {
    const read = continuity({ steers: [steer({ typed: false })] });
    expect(typedConversationOf({ continuity: read, window: answered }).turns).toEqual([]);
  });

  it("gives a console steer no answer when the supervisor chat could not be read", () => {
    const read = continuity({ steers: [steer()] });
    expect(typedConversationOf({ continuity: read, window: undefined }).turns[0]!.reply).toBe(undefined);
  });

  it("keeps the newest turns that fit its budget and counts the older ones left out", () => {
    const typed = Array.from({ length: 12 }, (_, index) => ({
      atIso: `2026-10-03T09:${String(10 + index)}:00.000Z`,
      reply: { atIso: `2026-10-03T09:${String(10 + index)}:30.000Z`, text: "é".repeat(300) },
      text: `turn ${String(index)} ${"x".repeat(580)}`,
    }));
    const conversation = typedConversationOf({ continuity: continuity({ typed }), window: undefined });
    const bytes = typedConversationLines({ conversation })
      .filter((line) => line.startsWith("- ") || line.startsWith("  "))
      .reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
    expect(conversation.turns.length + conversation.cut).toBe(12);
    expect(conversation.cut).toBeGreaterThan(0);
    expect(conversation.turns.at(-1)!.text.startsWith("turn 11 ")).toBe(true);
    expect(bytes).toBeLessThanOrEqual(TYPED_CONVERSATION_BYTES);
  });

  // The window marks a turn `viaVoice` by its opening alone, so a relay-shaped turn no steer row
  // explains is the owner's own typing, not a relay.
  it("keeps a relay-shaped turn of the owner's that matches no steer row, with the chair's answer", () => {
    const window = chat({
      exchanges: [
        exchange({ atIso: "2026-10-03T09:12:30.000Z", text: "Got it.", who: "chair" }),
        exchange({ atIso: "2026-10-03T09:12:00.000Z", text: "[voice relay fake] the cafe at 3pm", viaVoice: true }),
        exchange({
          text: '[voice relay talk-aaaa11112222] the owner typed on the console: "we meet …"',
          viaVoice: true,
        }),
      ],
    });
    const read = continuity({ calls: [call()], steers: [steer()] });
    expect(typedConversationOf({ continuity: read, window }).turns).toEqual([
      { atIso: "2026-10-03T09:10:00.000Z", reply: undefined, text: "we meet at the cafe at 3pm", via: "console" },
      {
        atIso: "2026-10-03T09:12:00.000Z",
        reply: { atIso: "2026-10-03T09:12:30.000Z", text: "Got it." },
        text: "[voice relay fake] the cafe at 3pm",
        via: "chair",
      },
    ]);
  });

  it("reads no relay-shaped turn as the owner's own when the steers were not read whole", () => {
    const window = chat({
      exchanges: [exchange({ text: "[voice relay talk-cccc] the owner said …", viaVoice: true })],
    });
    const read = continuity({ unread: [{ section: "steers", why: "the ledger could not be read" }] });
    expect(typedConversationOf({ continuity: read, window }).turns).toEqual([]);
  });

  // A steer with no readable time is neither before nor after the owner's last call.
  it("is partial when a typed steer carries no readable time", () => {
    const read = continuity({ calls: [call()], steers: [steer({ atIso: "not-a-time" })] });
    const conversation = typedConversationOf({ continuity: read, window: undefined });
    expect(conversation.turns).toEqual([]);
    expect(conversation.partial).toBe(true);
  });

  it("is partial when the typed or steers half was not wholly read", () => {
    const read = continuity({ unread: [{ section: "typed", why: "no supervisor pinned" }] });
    expect(typedConversationOf({ continuity: read, window: undefined }).partial).toBe(true);
  });

  // An unreadable call file can be the owner's real last call, so the floor read off the others may be early.
  it("marks its floor uncertain when the calls were not all read", () => {
    const read = continuity({
      calls: [call()],
      unread: [{ section: "calls", why: "1 call file(s) could not be read" }],
    });
    const conversation = typedConversationOf({ continuity: read, window: undefined });
    expect(conversation.floorPartial).toBe(true);
    expect(conversation.partial).toBe(false);
  });
});

describe("typedConversationLines", () => {
  it("says nothing when the owner typed nothing since their last call", () => {
    const conversation = typedConversationOf({ continuity: continuity({ calls: [call()] }), window: undefined });
    expect(typedConversationLines({ conversation })).toEqual([]);
  });

  // With no call in the read, typing between the owner's real last call and the floor is not here.
  it("says where the read stopped when no call of the owner's falls inside it", () => {
    const conversation = typedConversationOf({ continuity: continuity(), window: undefined });
    expect(typedConversationLines({ conversation })).toEqual([]);
    expect(typedReadFloorLines({ conversation })).toEqual([
      `What the owner typed is read back only to ${SINCE}, not to their last call's opening, so anything they`,
      "typed before then is not here — delegate if they refer to it.",
    ]);
  });

  it("says nothing of the read's floor when the read reached the owner's last call", () => {
    const conversation = typedConversationOf({ continuity: continuity({ calls: [call()] }), window: undefined });
    expect(typedReadFloorLines({ conversation })).toEqual([]);
  });

  // A supervisor chat that could not be read leaves no turn, and that is not "the owner typed nothing".
  it("still warns when the typed side was not read and no turn survived", () => {
    const read = continuity({ calls: [call()], unread: [{ section: "typed", why: "no supervisor pinned" }] });
    expect(
      typedConversationLines({ conversation: typedConversationOf({ continuity: read, window: undefined }) }),
    ).toEqual([
      "What the owner typed to you on the console since their last call could not be read, so they may have typed something",
      "this call continues — delegate to check before treating anything as their last word.",
    ]);
  });

  // The widest UTF-8 a clipped turn can carry — three bytes per UTF-16 unit — still fits the budget.
  it("always keeps the newest turn, however wide its characters", () => {
    const wide = "語".repeat(2000);
    const typed = [
      { atIso: "2026-10-03T09:10:00.000Z", reply: { atIso: "2026-10-03T09:11:00.000Z", text: wide }, text: wide },
      { atIso: "2026-10-03T09:20:00.000Z", reply: { atIso: "2026-10-03T09:21:00.000Z", text: wide }, text: wide },
    ];
    const conversation = typedConversationOf({ continuity: continuity({ calls: [call()], typed }), window: undefined });
    expect(conversation.turns.map((turn) => turn.atIso)).toEqual(["2026-10-03T09:20:00.000Z"]);
    expect(conversation.cut).toBe(1);
  });

  // A conversation that kept no turn but cut some still says how many were left out.
  it("names the turns left out when none was kept", () => {
    const conversation = {
      afterCall: true,
      cut: 2,
      floorPartial: false,
      partial: false,
      sinceIso: CALL_OPEN,
      turns: [],
    };
    expect(typedConversationLines({ conversation }).slice(4)).toEqual([
      "(2 earlier typed turn(s) not shown — delegate for them)",
    ]);
  });

  it("names the turns left out and warns off calling a partial read the owner's last word", () => {
    const lines = typedConversationLines({
      conversation: {
        afterCall: false,
        cut: 2,
        floorPartial: true,
        partial: true,
        sinceIso: SINCE,
        turns: [{ atIso: "2026-10-03T09:10:00.000Z", reply: undefined, text: "x", via: "chair" }],
      },
    });
    expect(lines.slice(4)).toEqual([
      "(2 earlier typed turn(s) not shown — delegate for them)",
      '- 2026-10-03T09:10:00.000Z the owner typed: "x"',
      "  (not answered yet)",
      "The owner's calls could not all be read, so some of these turns may come from before their last call.",
      "Part of what the owner typed could not be read, so they may have typed something newer — delegate to check",
      "before calling any of this their last word.",
    ]);
  });
});
