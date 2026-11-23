import { describe, expect, it } from "vitest";

import { isTypedLookAsk, type TypedLookState, typedLookGate, typedLookOnSend } from "../../lib/typedLookGate";

const replying: TypedLookState = { messageId: "m1", phase: "replying", spent: false, text: "look at my screen" };

describe("isTypedLookAsk", () => {
  it.each([
    "look at my screen",
    "Can you look at my screen?",
    "what am I looking at",
    "take a screenshot",
    "look at this",
    "Could you please take a look?",
    "ok, look at this",
    "look at this please",
    "Look at that. What's wrong with it?",
    "hey can you just take a screenshot",
    "I zoomed in. Take another look",
  ])("takes %s as an ask", (text) => {
    expect(isTypedLookAsk({ text })).toBe(true);
  });

  it.each([
    "are you looking at my screen?",
    "Are you actually looking at my screen",
    "can you see my screen?",
    "could you see the screen",
    "do you see my screen",
    "do you have access to my screen",
    "have you looked at my screen",
    "did you look at my screen",
    "how do you see my screen",
    "what can you see",
    "what did we decide about the ratchet",
    "I deleted this screenshot yesterday; how can I recover the file?",
    "I'll look at this later",
    "don't look at my screen",
    "please don't take a screenshot",
    "have a look at the pull request",
    "Look at this code: const total = items.reduce(sum). Why is it failing?",
    "Don't, please, look at my screen.",
    "Don’t. Look at my screen later",
    "no need, look at this tomorrow instead? not now",
  ])("does not take %s as an ask", (text) => {
    expect(isTypedLookAsk({ text })).toBe(false);
  });

  it("does not read a corrected figure as an ask, as speech does", () => {
    expect(isTypedLookAsk({ text: "no, it says seven hundred dollars" })).toBe(false);
  });
});

describe("typedLookOnSend", () => {
  it("gives an asking message unspent authority, still sending", () => {
    expect(typedLookOnSend({ messageId: "m1", setAside: false, text: "look at my screen" })).toEqual({
      messageId: "m1",
      phase: "sending",
      spent: false,
      text: "look at my screen",
    });
  });

  it("gives any other message none", () => {
    expect(
      typedLookOnSend({ messageId: "m1", setAside: false, text: "are you looking at my screen?" }),
    ).toBeUndefined();
  });

  it("gives an asking message none while an earlier send of unknown fate may still start the next turn", () => {
    expect(typedLookOnSend({ messageId: "m2", setAside: true, text: "look at my screen" })).toBeUndefined();
  });

  it("leaves an earlier owed send's read_screen with nothing to spend", () => {
    const state = typedLookOnSend({ messageId: "m2", setAside: true, text: "look at my screen" });
    expect(typedLookGate({ state, tool: "read_screen" }).kind).toBe("refuse");
  });
});

describe("typedLookGate", () => {
  it("allows the turn's one read_screen", () => {
    expect(typedLookGate({ state: replying, tool: "read_screen" })).toEqual({ kind: "allow", messageId: "m1" });
  });

  it.each([
    ["no authority", undefined, "read_screen"],
    ["authority spent", { ...replying, spent: true }, "read_screen"],
    ["a late call before the turn is announced", { ...replying, phase: "sending" as const }, "read_screen"],
    ["focus_screen, which stays call-only", replying, "focus_screen"],
  ])("refuses with %s", (_label, state, tool) => {
    expect(typedLookGate({ state, tool })).toEqual({
      kind: "refuse",
      reason:
        "No look was taken: the owner did not ask for one in this message. Ask what the owner is looking at, or for its link.",
    });
  });
});
