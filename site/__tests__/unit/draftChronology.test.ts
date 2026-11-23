/*
 * The order a held draft's card draws its conversation in. The anchored cases are shaped on a real held draft:
 * a bump in a seven-message ISO thread whose earlier ask is the thread's LAST message, so nothing was said since.
 */

import { describe, expect, it } from "vitest";

import { draftChronology, priorAskInConversation } from "../../lib/draftChronology";

/** A conversation of `count` messages whose ts are `1.000001`, `1.000002`, …, oldest first. */
function conversation({ count }: { count: number }): readonly { readonly ts: string }[] {
  return Array.from({ length: count }, (_, at) => ({ ts: `1.${String(at + 1).padStart(6, "0")}` }));
}

/** One message of {@link conversation}, by its 1-based position. */
function msg({ n }: { n: number }): { readonly ts: string } {
  return { ts: `1.${String(n).padStart(6, "0")}` };
}

describe("draftChronology, with the earlier ask in the conversation", () => {
  it("draws the earlier ask, folds what came between, then the latest three after it", () => {
    const segments = draftChronology({
      anchorTs: msg({ n: 3 }).ts,
      messages: conversation({ count: 9 }),
      scope: "thread",
    });
    expect(segments).toEqual([
      { kind: "fold", messages: [msg({ n: 1 }), msg({ n: 2 })], place: "earlier" },
      { anchor: true, kind: "message", message: msg({ n: 3 }) },
      { kind: "fold", messages: [msg({ n: 4 }), msg({ n: 5 }), msg({ n: 6 })], place: "between" },
      { anchor: false, kind: "message", message: msg({ n: 7 }) },
      { anchor: false, kind: "message", message: msg({ n: 8 }) },
      { anchor: false, kind: "message", message: msg({ n: 9 }) },
    ]);
  });

  it("says nothing was said since when the earlier ask is the latest message", () => {
    const segments = draftChronology({
      anchorTs: msg({ n: 7 }).ts,
      messages: conversation({ count: 7 }),
      scope: "thread",
    });
    expect(segments).toEqual([
      { kind: "fold", messages: conversation({ count: 6 }), place: "earlier" },
      { anchor: true, kind: "message", message: msg({ n: 7 }) },
      { kind: "quiet-since" },
    ]);
  });

  it("draws no ellipsis when every message after the earlier ask fits open", () => {
    const segments = draftChronology({
      anchorTs: msg({ n: 1 }).ts,
      messages: conversation({ count: 3 }),
      scope: "channel",
    });
    expect(segments).toEqual([
      { anchor: true, kind: "message", message: msg({ n: 1 }) },
      { anchor: false, kind: "message", message: msg({ n: 2 }) },
      { anchor: false, kind: "message", message: msg({ n: 3 }) },
    ]);
  });
});

describe("draftChronology, with no earlier ask in the conversation", () => {
  it("keeps a thread's root and its latest three replies open, folding the rest", () => {
    const segments = draftChronology({ anchorTs: "9.000000", messages: conversation({ count: 6 }), scope: "thread" });
    expect(segments).toEqual([
      { anchor: false, kind: "message", message: msg({ n: 1 }) },
      { kind: "fold", messages: [msg({ n: 2 }), msg({ n: 3 })], place: "earlier" },
      { anchor: false, kind: "message", message: msg({ n: 4 }) },
      { anchor: false, kind: "message", message: msg({ n: 5 }) },
      { anchor: false, kind: "message", message: msg({ n: 6 }) },
    ]);
  });

  it("keeps a channel's latest three open when the draft repeats no earlier ask", () => {
    const segments = draftChronology({ anchorTs: undefined, messages: conversation({ count: 5 }), scope: "channel" });
    expect(segments).toEqual([
      { kind: "fold", messages: [msg({ n: 1 }), msg({ n: 2 })], place: "earlier" },
      { anchor: false, kind: "message", message: msg({ n: 3 }) },
      { anchor: false, kind: "message", message: msg({ n: 4 }) },
      { anchor: false, kind: "message", message: msg({ n: 5 }) },
    ]);
  });

  it("draws nothing for an empty conversation", () => {
    expect(draftChronology({ anchorTs: undefined, messages: [], scope: "thread" })).toEqual([]);
  });
});

describe("priorAskInConversation", () => {
  it("is true only when a message of the conversation carries the earlier ask's ts", () => {
    const messages = conversation({ count: 3 });
    expect(priorAskInConversation({ anchorTs: msg({ n: 2 }).ts, messages })).toBe(true);
    expect(priorAskInConversation({ anchorTs: "9.000000", messages })).toBe(false);
    expect(priorAskInConversation({ anchorTs: undefined, messages })).toBe(false);
  });
});
