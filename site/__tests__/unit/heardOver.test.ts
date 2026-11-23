import { describe, expect, it } from "vitest";

import {
  type HeardOver,
  heardOverAfter,
  relayAbout,
  relayAboutJudged,
  relayJudgeable,
  relayLines,
  relaySpokenIn,
} from "../../lib/heardOver";
import type { WorkContext } from "../../lib/workContext";

/** Fold a run of transcript events, in order, from nothing heard. */
function fold({
  events,
}: {
  events: readonly {
    segmentId: string;
    who: "owner" | "voice";
    open: string | undefined;
    context?: WorkContext | undefined;
  }[];
}): HeardOver | undefined {
  return events.reduce<HeardOver | undefined>(
    (held, event) =>
      heardOverAfter({
        context: event.context,
        held,
        open: event.open,
        segmentId: event.segmentId,
        who: event.who,
      }),
    undefined,
  );
}

describe("which card a relay is about", () => {
  it("is the card the owner began speaking over, after the owner has opened the next one", () => {
    const held = fold({
      events: [
        { open: "hand:voice-mark-step", segmentId: "s-1", who: "owner" },
        { open: "pr:16406", segmentId: "s-1", who: "owner" },
      ],
    });
    expect(relayAbout({ held, openNow: "pr:16406" })).toBe("hand:voice-mark-step");
  });

  // "ship A" over one card, then "separately, inspect B" over the next, relayed together.
  it("is none when the owner's words since the last relay began over more than one card", () => {
    const held = fold({
      events: [
        { open: "hand:voice-mark-step", segmentId: "s-1", who: "owner" },
        { open: "ask:next-card", segmentId: "s-2", who: "owner" },
      ],
    });
    expect(relayAbout({ held, openNow: "ask:next-card" })).toBe("");
  });

  // "bring me the first card" over none, then the owner's rejection over the card the voice opened.
  it("is the one card when the rest of the owner's words since the last relay were said over no card", () => {
    const held = fold({
      events: [
        { open: undefined, segmentId: "s-1", who: "owner" },
        { open: "ask:owner-steer-console-card", segmentId: "s-2", who: "owner" },
      ],
    });
    expect(relayAbout({ held, openNow: undefined })).toBe("ask:owner-steer-console-card");
  });

  it("is none when the owner's words since the last relay began over no card and over two cards", () => {
    const held = fold({
      events: [
        { open: undefined, segmentId: "s-1", who: "owner" },
        { open: "pr:16406", segmentId: "s-2", who: "owner" },
        { open: "ask:next-card", segmentId: "s-3", who: "owner" },
      ],
    });
    expect(relayAbout({ held, openNow: "ask:next-card" })).toBe("");
  });

  it("is the one card when every utterance since the last relay began over it", () => {
    const held = fold({
      events: [
        { open: "pr:16406", segmentId: "s-1", who: "owner" },
        { open: "pr:16406", segmentId: "s-2", who: "owner" },
      ],
    });
    expect([held, relayAbout({ held, openNow: undefined })]).toEqual([
      { contexts: [undefined], lastOpen: "pr:16406", opens: ["pr:16406"], segmentId: "s-2" },
      "pr:16406",
    ]);
  });

  it("is not moved by the voice speaking over another card", () => {
    const held = fold({
      events: [
        { open: "hand:voice-mark-step", segmentId: "s-1", who: "owner" },
        { open: "pr:16406", segmentId: "s-2", who: "voice" },
      ],
    });
    expect(relayAbout({ held, openNow: "pr:16406" })).toBe("hand:voice-mark-step");
  });

  it("is none when the owner spoke with no card open, whatever is open now", () => {
    const held = fold({ events: [{ open: undefined, segmentId: "s-1", who: "owner" }] });
    expect(relayAbout({ held, openNow: "pr:16406" })).toBe("");
  });

  it("is the card open now when the owner has not spoken this call", () => {
    expect(relayAbout({ held: undefined, openNow: "pr:16406" })).toBe("pr:16406");
  });

  it("is none when the owner has not spoken and no card is open", () => {
    expect(relayAbout({ held: undefined, openNow: undefined })).toBe("");
  });
});

// Measured: "Next card, please" over one card, then the owner's answer over the card the voice opened next.
describe("which card the voice's judgement may land on", () => {
  const walked = fold({
    events: [
      { open: "ask:the-last-card", segmentId: "s-1", who: "owner" },
      { open: undefined, segmentId: "s-2", who: "owner" },
      { open: "ask:the-next-card", segmentId: "s-3", who: "owner" },
    ],
  });

  it("is the card still open that the owner's latest words began over, when they began over two cards", () => {
    expect([
      relayAbout({ held: walked, openNow: "ask:the-next-card" }),
      relayJudgeable({ held: walked, openNow: "ask:the-next-card" }),
    ]).toEqual(["", "ask:the-next-card"]);
  });

  it("is none once the card the owner's latest words began over is no longer the one open", () => {
    expect([
      relayJudgeable({ held: walked, openNow: "ask:the-last-card" }),
      relayJudgeable({ held: walked, openNow: "ask:a-third-card" }),
      relayJudgeable({ held: walked, openNow: undefined }),
    ]).toEqual(["", "", ""]);
  });

  it("is none when the owner's latest words began over no card, whatever is open", () => {
    const endedOverNone = fold({
      events: [
        { open: "ask:first", segmentId: "s-1", who: "owner" },
        { open: "ask:second", segmentId: "s-2", who: "owner" },
        { open: undefined, segmentId: "s-3", who: "owner" },
      ],
    });
    expect([endedOverNone!.lastOpen, relayJudgeable({ held: endedOverNone, openNow: "ask:second" })]).toEqual([
      undefined,
      "",
    ]);
  });

  it("is relayAbout's own card whenever that names one", () => {
    const oneCard = fold({ events: [{ open: "pr:16406", segmentId: "s-1", who: "owner" }] });
    expect([
      relayJudgeable({ held: oneCard, openNow: "ask:next-card" }),
      relayJudgeable({ held: undefined, openNow: "pr:16406" }),
      relayJudgeable({ held: undefined, openNow: undefined }),
    ]).toEqual(["pr:16406", "pr:16406", ""]);
  });

  it("keeps the latest utterance's card through later events of the same segment and the voice's speech", () => {
    const held = fold({
      events: [
        { open: "ask:first", segmentId: "s-1", who: "owner" },
        { open: "ask:second", segmentId: "s-2", who: "owner" },
        { open: "ask:third", segmentId: "s-2", who: "owner" },
        { open: "ask:fourth", segmentId: "s-3", who: "voice" },
      ],
    });
    expect(held).toEqual({
      contexts: [undefined],
      lastOpen: "ask:second",
      opens: ["ask:first", "ask:second"],
      segmentId: "s-2",
    });
  });
});

// The owner speaks over no card on one console, then switches before the voice relays the words. Measured:
// "Uh, good morning", relayed about the open Twilio hand step, hid it.
describe("which card a relay is about once the voice judged the owner's words", () => {
  it("is the card the owner spoke over only when the voice judged them its answer, and never a hand step", () => {
    expect([
      relayAboutJudged({ answersOpenCard: true, spokenOver: "ask:the-ask" }),
      relayAboutJudged({ answersOpenCard: false, spokenOver: "ask:the-ask" }),
      relayAboutJudged({ answersOpenCard: true, spokenOver: "hand:twilio-and-knock-read-only-keys" }),
      relayAboutJudged({ answersOpenCard: true, spokenOver: "" }),
    ]).toEqual(["ask:the-ask", "", "", ""]);
  });
});

describe("which console a relay over no card was said on", () => {
  it("is the console the owner's words began on, not the one the owner switched to before the relay", () => {
    const held = fold({ events: [{ context: "work", open: undefined, segmentId: "s-1", who: "owner" }] });
    expect(relaySpokenIn({ held })).toBe("work");
  });

  it("is none when the owner's words since the last relay began on two consoles", () => {
    const held = fold({
      events: [
        { context: "work", open: undefined, segmentId: "s-1", who: "owner" },
        { context: "slopweaver", open: undefined, segmentId: "s-2", who: "owner" },
      ],
    });
    expect(relaySpokenIn({ held })).toBe(undefined);
  });

  it("is none when any of the owner's words began over a card, or on a console the page could not name", () => {
    const overACard = fold({
      events: [
        { context: "work", open: undefined, segmentId: "s-1", who: "owner" },
        { context: "work", open: "pr:16406", segmentId: "s-2", who: "owner" },
      ],
    });
    const unnamed = fold({ events: [{ context: undefined, open: undefined, segmentId: "s-1", who: "owner" }] });
    expect([relaySpokenIn({ held: overACard }), relaySpokenIn({ held: unnamed })]).toEqual([undefined, undefined]);
  });

  // No words means no stamp, and the console at hand-off is not where anything was said.
  it("is none when the owner has said nothing since the last relay, whatever console the page is on", () => {
    expect(relaySpokenIn({ held: undefined })).toBe(undefined);
  });
});

// A relay of a call the owner has since left records to its own call, and takes no card of the next.
describe("one relay's lines", () => {
  it("follows the owner's words while its call is current, and keeps its call and first card once another call began", () => {
    let current = "call-1";
    let open = "hand:a";
    const recorded: { call: string | undefined; line: string }[] = [];
    const lines = relayLines<string>({
      openNow: () => open,
      record: (row) => {
        recorded.push(row);
      },
      transcript: { current: () => current, heardOver: () => undefined },
    });
    open = "hand:b";
    const whileCurrent = [lines.about(), lines.judgeable()];
    current = "call-2";
    open = "hand:c";
    lines.record({ line: "sent" });
    expect([whileCurrent, lines.about(), lines.judgeable(), recorded]).toEqual([
      ["hand:b", "hand:b"],
      "hand:a",
      "hand:a",
      [{ call: "call-1", line: "sent" }],
    ]);
  });
});
