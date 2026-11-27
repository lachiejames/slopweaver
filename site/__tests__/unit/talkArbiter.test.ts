/*
 * One conversation per console: what a typed open, a voice offer and a typed send are each told, over every live
 * conversation the server holds.
 */
import { describe, expect, it } from "vitest";

import {
  CALL_CHANGED,
  CALL_IS_UP,
  conversationRuling,
  E2E_CONVERSATION_HELD,
  E2E_TYPED_HELD,
  instanceOfBody,
  type LiveConversation,
  liveVoiceCallOf,
  NO_CALL_UP,
  TYPED_AT_REST_MS,
  TYPED_IS_REPLYING,
  typedAtRest,
  typedSendRefusal,
  typedWantedOf,
} from "../../lib/talkArbiter";

const VOICE: LiveConversation = { atRest: false, replying: false, surface: "voice", test: false };
const TYPED_IDLE: LiveConversation = { atRest: false, replying: false, surface: "typed", test: false };
const TYPED_REPLYING: LiveConversation = { atRest: false, replying: true, surface: "typed", test: false };
const TYPED_AT_REST: LiveConversation = { atRest: true, replying: false, surface: "typed", test: false };
const TEST_CALL: LiveConversation = { atRest: false, replying: false, surface: "voice", test: true };

describe("typedAtRest", () => {
  const LAST = 1_000_000;

  it("is at rest from exactly the bound on, and not a millisecond before", () => {
    expect([
      typedAtRest({ lastActiveMs: LAST, nowMs: LAST + TYPED_AT_REST_MS - 1, replying: false }),
      typedAtRest({ lastActiveMs: LAST, nowMs: LAST + TYPED_AT_REST_MS, replying: false }),
    ]).toEqual([false, true]);
  });

  it("is the chosen ten minutes", () => {
    expect(TYPED_AT_REST_MS).toBe(600_000);
  });

  it("fails closed while replying, on a clock that runs backwards, and on an instant that is not a number", () => {
    const long = LAST + TYPED_AT_REST_MS * 10;
    expect([
      typedAtRest({ lastActiveMs: LAST, nowMs: long, replying: true }),
      typedAtRest({ lastActiveMs: long, nowMs: LAST, replying: false }),
      typedAtRest({ lastActiveMs: Number.NaN, nowMs: long, replying: false }),
      typedAtRest({ lastActiveMs: LAST, nowMs: Number.NaN, replying: false }),
      typedAtRest({ lastActiveMs: Number.NEGATIVE_INFINITY, nowMs: long, replying: false }),
    ]).toEqual([false, false, false, false, false]);
  });
});

describe("conversationRuling for a typed conversation", () => {
  it("goes, ending nothing, when nothing is live", () => {
    expect(conversationRuling({ live: [], wanted: "typed" })).toEqual({ end: [], kind: "go" });
  });

  it("is refused while a voice call is up, ending nothing", () => {
    expect(conversationRuling({ live: [TYPED_IDLE, VOICE], wanted: "typed" })).toEqual({
      kind: "refused",
      reason: CALL_IS_UP,
    });
  });

  it("replaces every older typed one, replying or not", () => {
    expect(conversationRuling({ live: [TYPED_REPLYING, TYPED_IDLE], wanted: "typed" })).toEqual({
      end: [0, 1],
      kind: "go",
    });
  });

  it("reads past a test call: never refused by one, and never ends one", () => {
    expect([
      conversationRuling({ live: [TEST_CALL], wanted: "typed" }),
      conversationRuling({ live: [TYPED_AT_REST, TEST_CALL], wanted: "typed" }),
    ]).toEqual([
      { end: [], kind: "go" },
      { end: [0], kind: "go" },
    ]);
  });
});

describe("conversationRuling for the desktop test instance's typed conversation", () => {
  const TEST_TYPED: LiveConversation = { atRest: false, replying: false, surface: "typed", test: true };
  const REFUSED = { kind: "refused", reason: E2E_TYPED_HELD };

  it("goes, ending nothing, when nothing is held", () => {
    expect(conversationRuling({ live: [], wanted: "e2e-typed" })).toEqual({ end: [], kind: "go" });
  });

  // The counterexample: an owner's typed conversation at rest is never replaced by a test typed open.
  it("is refused beside any owner conversation, at rest or not, so it replaces none of them", () => {
    expect([
      conversationRuling({ live: [TYPED_AT_REST], wanted: "e2e-typed" }),
      conversationRuling({ live: [TYPED_IDLE], wanted: "e2e-typed" }),
      conversationRuling({ live: [TYPED_REPLYING], wanted: "e2e-typed" }),
      conversationRuling({ live: [VOICE], wanted: "e2e-typed" }),
      conversationRuling({ live: [TEST_TYPED, TYPED_AT_REST], wanted: "e2e-typed" }),
    ]).toEqual([REFUSED, REFUSED, REFUSED, REFUSED, REFUSED]);
  });

  it("waits on its own test call, and replaces only its own older typed one", () => {
    expect([
      conversationRuling({ live: [TEST_CALL], wanted: "e2e-typed" }),
      conversationRuling({ live: [TEST_TYPED], wanted: "e2e-typed" }),
    ]).toEqual([
      { kind: "refused", reason: CALL_IS_UP },
      { end: [0], kind: "go" },
    ]);
  });

  it("is left standing by the owner's typed open, which replaces only the owner's own", () => {
    expect(conversationRuling({ live: [TEST_TYPED, TYPED_AT_REST], wanted: "typed" })).toEqual({
      end: [1],
      kind: "go",
    });
  });
});

describe("instanceOfBody and typedWantedOf", () => {
  it("reads absent as the owner's page and e2e as the test instance's", () => {
    expect([
      instanceOfBody({ body: {} }),
      instanceOfBody({ body: { instance: "e2e" } }),
      typedWantedOf({ instance: "owner" }),
      typedWantedOf({ instance: "e2e" }),
    ]).toEqual([{ instance: "owner" }, { instance: "e2e" }, "typed", "e2e-typed"]);
  });

  it("refuses any other instance, and never reads an inherited one", () => {
    const inherited: Record<string, unknown> = Object.create({ instance: "e2e" }) as Record<string, unknown>;
    const refused = { refused: "the body's instance is not one this route reads: absent, or e2e" };
    expect([
      instanceOfBody({ body: { instance: "owner" } }),
      instanceOfBody({ body: { instance: null } }),
      instanceOfBody({ body: inherited }),
    ]).toEqual([refused, refused, { instance: "owner" }]);
  });
});

describe("conversationRuling for a voice call", () => {
  it("goes, ending nothing, when nothing is live", () => {
    expect(conversationRuling({ live: [], wanted: "voice" })).toEqual({ end: [], kind: "go" });
  });

  it("ends an idle typed conversation first, by its index", () => {
    expect(conversationRuling({ live: [VOICE, TYPED_IDLE], wanted: "voice" })).toEqual({ end: [1], kind: "go" });
  });

  it("is refused while a typed answer is still being written", () => {
    expect(conversationRuling({ live: [TYPED_IDLE, TYPED_REPLYING], wanted: "voice" })).toEqual({
      kind: "refused",
      reason: TYPED_IS_REPLYING,
    });
  });

  it("leaves a voice call already up to the page's own one-call rule", () => {
    expect(conversationRuling({ live: [VOICE], wanted: "voice" })).toEqual({ end: [], kind: "go" });
  });

  it("ends a test call up, in index order with the typed ones, rather than waiting on it", () => {
    expect(conversationRuling({ live: [TEST_CALL, TYPED_AT_REST], wanted: "voice" })).toEqual({
      end: [0, 1],
      kind: "go",
    });
  });
});

describe("conversationRuling for the desktop test instance's call", () => {
  /** The refusal every held conversation earns it, whatever it is. */
  const REFUSED = { kind: "refused", reason: E2E_CONVERSATION_HELD };

  it("goes, ending nothing, when nothing is held", () => {
    expect(conversationRuling({ live: [], wanted: "e2e-voice" })).toEqual({ end: [], kind: "go" });
  });

  // The fix: a typed conversation at rest stays held and is never ended by the proof beside it.
  it("goes beside typed conversations at rest, ending none of them", () => {
    expect([
      conversationRuling({ live: [TYPED_AT_REST], wanted: "e2e-voice" }),
      conversationRuling({ live: [TYPED_AT_REST, TYPED_AT_REST], wanted: "e2e-voice" }),
    ]).toEqual([
      { end: [], kind: "go" },
      { end: [], kind: "go" },
    ]);
  });

  it("is refused beside a test call already up, and beside one at rest with any other held", () => {
    expect([
      conversationRuling({ live: [TEST_CALL], wanted: "e2e-voice" }),
      conversationRuling({ live: [TYPED_AT_REST, TYPED_IDLE], wanted: "e2e-voice" }),
      conversationRuling({ live: [TYPED_AT_REST, VOICE], wanted: "e2e-voice" }),
    ]).toEqual([REFUSED, REFUSED, REFUSED]);
  });

  // The owner's typed conversation not yet at rest holds no lease, and their voice call's test above ends it.
  it("is refused beside the owner's typed conversation not yet at rest, which it would otherwise end", () => {
    expect([
      conversationRuling({ live: [TYPED_IDLE], wanted: "voice" }),
      conversationRuling({ live: [TYPED_IDLE], wanted: "e2e-voice" }),
    ]).toEqual([{ end: [0], kind: "go" }, REFUSED]);
  });

  it("is refused beside a voice call, leased or not, where the owner's own call would go", () => {
    expect([
      conversationRuling({ live: [VOICE], wanted: "voice" }),
      conversationRuling({ live: [VOICE], wanted: "e2e-voice" }),
    ]).toEqual([{ end: [], kind: "go" }, REFUSED]);
  });

  it("is refused beside a typed answer still being written, and beside several, ending none", () => {
    expect([
      conversationRuling({ live: [TYPED_REPLYING], wanted: "e2e-voice" }),
      conversationRuling({ live: [VOICE, TYPED_IDLE, TYPED_REPLYING], wanted: "e2e-voice" }),
    ]).toEqual([REFUSED, REFUSED]);
  });
});

describe("liveVoiceCallOf", () => {
  /** A call made at 1000 ms, a typed conversation beside it, and the owner's press after both. */
  const MADE_VOICE = { ...VOICE, madeMs: 1_000 };
  const MADE_TYPED = { ...TYPED_IDLE, madeMs: 500 };
  const PRESSED_MS = 2_000;

  it("picks the one voice call among typed conversations", () => {
    expect(liveVoiceCallOf({ live: [MADE_TYPED, MADE_VOICE], instance: "owner", pressedMs: PRESSED_MS })).toEqual({
      call: MADE_VOICE,
      kind: "one",
    });
  });

  it("says no call is up with none, typed ones aside", () => {
    expect([
      liveVoiceCallOf({ live: [{ ...TYPED_REPLYING, madeMs: 500 }], instance: "owner", pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [], instance: "owner", pressedMs: PRESSED_MS }),
    ]).toEqual([
      { kind: "none", reason: NO_CALL_UP },
      { kind: "none", reason: NO_CALL_UP },
    ]);
  });

  it("hands the test instance's words only to its own test call, never the owner's", () => {
    const testCall = { ...TEST_CALL, madeMs: 1_200 };
    expect([
      liveVoiceCallOf({ instance: "e2e", live: [testCall, MADE_VOICE], pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ instance: "e2e", live: [MADE_VOICE, MADE_TYPED], pressedMs: PRESSED_MS }),
    ]).toEqual([
      { call: testCall, kind: "one" },
      { kind: "none", reason: NO_CALL_UP },
    ]);
  });

  it("never picks a test call for the owner, so the owner's typed words never reach one", () => {
    expect([
      liveVoiceCallOf({ live: [{ ...TEST_CALL, madeMs: 1_000 }], instance: "owner", pressedMs: PRESSED_MS }),
      liveVoiceCallOf({
        live: [{ ...TEST_CALL, madeMs: 1_200 }, MADE_VOICE],
        instance: "owner",
        pressedMs: PRESSED_MS,
      }),
    ]).toEqual([
      { kind: "none", reason: NO_CALL_UP },
      { call: MADE_VOICE, kind: "one" },
    ]);
  });

  it("refuses to guess between two voice calls", () => {
    expect(
      liveVoiceCallOf({
        live: [MADE_VOICE, MADE_TYPED, { ...MADE_VOICE, madeMs: 1_500 }],
        instance: "owner",
        pressedMs: PRESSED_MS,
      }),
    ).toEqual({ kind: "several", reason: "2 voice calls are up; hang up all but one, then send" });
  });

  it("refuses a call made at or after the owner's press, which is not the one they were typing to, and takes one made before", () => {
    expect([
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS + 1 }], instance: "owner", pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS }], instance: "owner", pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS - 1 }], instance: "owner", pressedMs: PRESSED_MS })
        .kind,
    ]).toEqual([{ kind: "newer", reason: CALL_CHANGED }, { kind: "newer", reason: CALL_CHANGED }, "one"]);
  });
});

describe("typedSendRefusal", () => {
  it("lets a send go with only typed conversations live", () => {
    expect(typedSendRefusal({ live: [TYPED_REPLYING] })).toBeUndefined();
  });

  it("refuses a send while a voice call is up", () => {
    expect(typedSendRefusal({ live: [TYPED_IDLE, VOICE] })).toBe(CALL_IS_UP);
  });

  it("lets a send go beside a test call, which is no call of the owner's", () => {
    expect(typedSendRefusal({ live: [TYPED_AT_REST, TEST_CALL] })).toBeUndefined();
  });
});
