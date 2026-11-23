/*
 * `askLifecycleKey`: an ask is keyed on `(channel, messageTs)`, never `threadTs`, so two asks sharing a thread
 * root never collide, and the key cannot be fooled by a boundary shift a delimited join would. It was split out
 * when the ask-lifecycle suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { askLifecycleKey } from "../../../../../live/ask/lifecycle.js";
import { CAPTURED } from "./harness.js";

describe("askLifecycleKey", () => {
  it("keys on channel and messageTs, not threadTs", () => {
    expect(askLifecycleKey({ askIdentity: CAPTURED })).toBe(JSON.stringify(["C1", "1785000000.000100"]));
  });

  it("gives two asks sharing a thread root DIFFERENT keys", () => {
    const second = { ...CAPTURED, messageTs: "1785000000.000200" };

    expect(askLifecycleKey({ askIdentity: CAPTURED })).not.toBe(askLifecycleKey({ askIdentity: second }));
  });

  /**
   * The exact bug a naive `${channel}:${messageTs}` join would reintroduce: two DIFFERENT (channel,
   * messageTs) pairs whose delimited join happens to produce the same string.
   */
  it("does not collide when a channel/messageTs boundary shift would fool a delimited join", () => {
    const left = { ...CAPTURED, channel: "C:A", messageTs: "1" };
    const right = { ...CAPTURED, channel: "C", messageTs: "A:1" };

    expect(askLifecycleKey({ askIdentity: left })).not.toBe(askLifecycleKey({ askIdentity: right }));
  });
});
