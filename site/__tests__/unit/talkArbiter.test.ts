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
  type LiveConversation,
  liveVoiceCallOf,
  NO_CALL_UP,
  TYPED_IS_REPLYING,
  typedSendRefusal,
} from "../../lib/talkArbiter";

const VOICE: LiveConversation = { replying: false, surface: "voice" };
const TYPED_IDLE: LiveConversation = { replying: false, surface: "typed" };
const TYPED_REPLYING: LiveConversation = { replying: true, surface: "typed" };

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
});

describe("conversationRuling for the desktop test instance's call", () => {
  /** The refusal every held conversation earns it, whatever it is. */
  const REFUSED = { kind: "refused", reason: E2E_CONVERSATION_HELD };

  it("goes, ending nothing, only when nothing is held", () => {
    expect(conversationRuling({ live: [], wanted: "e2e-voice" })).toEqual({ end: [], kind: "go" });
  });

  // The regression: the owner's idle typed conversation holds no lease, and their voice call's test above ends it.
  it("is refused beside the owner's idle typed conversation, which it would otherwise end", () => {
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
    expect(liveVoiceCallOf({ live: [MADE_TYPED, MADE_VOICE], pressedMs: PRESSED_MS })).toEqual({
      call: MADE_VOICE,
      kind: "one",
    });
  });

  it("says no call is up with none, typed ones aside", () => {
    expect([
      liveVoiceCallOf({ live: [{ ...TYPED_REPLYING, madeMs: 500 }], pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [], pressedMs: PRESSED_MS }),
    ]).toEqual([
      { kind: "none", reason: NO_CALL_UP },
      { kind: "none", reason: NO_CALL_UP },
    ]);
  });

  it("refuses to guess between two voice calls", () => {
    expect(
      liveVoiceCallOf({ live: [MADE_VOICE, MADE_TYPED, { ...MADE_VOICE, madeMs: 1_500 }], pressedMs: PRESSED_MS }),
    ).toEqual({ kind: "several", reason: "2 voice calls are up; hang up all but one, then send" });
  });

  it("refuses a call made at or after the owner's press, which is not the one they were typing to, and takes one made before", () => {
    expect([
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS + 1 }], pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS }], pressedMs: PRESSED_MS }),
      liveVoiceCallOf({ live: [{ ...MADE_VOICE, madeMs: PRESSED_MS - 1 }], pressedMs: PRESSED_MS }).kind,
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
});
