import { describe, expect, it } from "vitest";

import type { AskDestination, AskMention } from "../../../handover/askAction.js";
import {
  ACTION_LABEL_MAX_CHARS,
  ACTION_MAX_RECIPIENTS,
  destinationKey,
  destinationLetterProblem,
  destinationProblems,
  labelProblems,
  MEMBER_ID,
  peopleProblems,
} from "../../../handover/askActionDestination.js";

/** One well-formed person, cloned per case so a list is built without repeating the shape. */
const person = ({ n }: { n: number }): AskMention => ({
  label: `Reviewer ${String(n)}`,
  userId: `U0SYNREVIEWER${String(n)}`,
});

/** A well-formed direct message — the destination with the most rules of its own. */
const DM: Extract<AskDestination, { kind: "dm" }> = {
  conversation: "D01GROUP",
  kind: "dm",
  label: "DM the three of them",
  recipients: [person({ n: 1 }), person({ n: 2 })],
  tradeoff: "quieter than the channel, and nobody else learns it is blocked",
};

describe("destinationKey", () => {
  it("separates a channel from a thread inside that same channel", () => {
    const channel: AskDestination = {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees it",
    };
    const thread: AskDestination = {
      channel: "C01SDLC",
      kind: "thread",
      label: "Reply in the thread",
      threadTs: "1758531703.123456",
      tradeoff: "only the people already in it see it",
    };
    expect(destinationKey({ destination: channel })).toBe("channel:C01SDLC");
    expect(destinationKey({ destination: thread })).toBe("thread:C01SDLC:1758531703.123456");
  });

  it("keys a direct message by its conversation", () => {
    expect(destinationKey({ destination: DM })).toBe("dm:D01GROUP");
  });
});

describe("labelProblems", () => {
  it("says nothing about a label within its cap", () => {
    expect(labelProblems({ label: "Post it to #delivery", what: "the channel" })).toEqual([]);
  });

  it("refuses a blank label, naming what it was on", () => {
    expect(labelProblems({ label: "   ", what: "the dm" })).toEqual([
      "the dm has no label — the card shows a name, never a raw id",
    ]);
  });

  it("names the character count and the cap on an over-long label", () => {
    const long = "x".repeat(ACTION_LABEL_MAX_CHARS + 1);
    expect(labelProblems({ label: long, what: "the channel" })).toEqual([
      `the channel's label runs ${String(ACTION_LABEL_MAX_CHARS + 1)} characters against a cap of ` +
        `${String(ACTION_LABEL_MAX_CHARS)} — it sits on one line of the card`,
    ]);
  });

  it("measures the TRIMMED label, so surrounding whitespace cannot push one over", () => {
    const padded = ` ${"x".repeat(ACTION_LABEL_MAX_CHARS)} `;
    expect(labelProblems({ label: padded, what: "the channel" })).toEqual([]);
  });
});

describe("MEMBER_ID", () => {
  it("accepts both member id prefixes Slack issues", () => {
    expect(MEMBER_ID.test("U01ARI")).toBe(true);
    expect(MEMBER_ID.test("W01GUEST")).toBe(true);
  });

  it("refuses a conversation id, which is the id most easily passed by mistake", () => {
    expect(MEMBER_ID.test("C01SDLC")).toBe(false);
    expect(MEMBER_ID.test("D01GROUP")).toBe(false);
  });
});

describe("peopleProblems", () => {
  it("says nothing about a well-formed list", () => {
    expect(peopleProblems({ people: [person({ n: 1 }), person({ n: 2 })], what: "a mention" })).toEqual([]);
  });

  it("names a repeat by its id, once, on the second sighting", () => {
    const twice = [person({ n: 1 }), person({ n: 1 })];
    expect(peopleProblems({ people: twice, what: "a mention" })).toEqual([
      "U0SYNREVIEWER1 is named twice as a mention",
    ]);
  });

  it("refuses an id that is not a member id", () => {
    expect(peopleProblems({ people: [{ label: "SDLC", userId: "C01SDLC" }], what: "a recipient" })).toEqual([
      "C01SDLC is not a Slack member id",
    ]);
  });

  it("says nothing about an empty list — a list's own emptiness is the destination's rule, not a person's", () => {
    expect(peopleProblems({ people: [], what: "a mention" })).toEqual([]);
  });
});

describe("destinationProblems — the direct-message recipient cap", () => {
  it("passes a group DM at exactly the cap", () => {
    const recipients = Array.from({ length: ACTION_MAX_RECIPIENTS }, (_unused, index) => person({ n: index }));
    expect(destinationProblems({ destination: { ...DM, recipients } })).toEqual([]);
  });

  it("names the count and the cap one person past it", () => {
    const over = ACTION_MAX_RECIPIENTS + 1;
    const recipients = Array.from({ length: over }, (_unused, index) => person({ n: index }));
    expect(destinationProblems({ destination: { ...DM, recipients } })).toEqual([
      `the direct message names ${String(over)} people against a cap of ${String(ACTION_MAX_RECIPIENTS)} — ` +
        "past that it is a channel post wearing a DM's clothes",
    ]);
  });

  it("refuses a direct message that names nobody", () => {
    expect(destinationProblems({ destination: { ...DM, recipients: [] } })).toEqual([
      "the direct message names nobody",
    ]);
  });

  it("refuses a conversation id a `slack dm open` never produced", () => {
    expect(destinationProblems({ destination: { ...DM, conversation: "U01ARI" } })).toEqual([
      "U01ARI is not an open Slack conversation — " +
        "`slopweaver slack dm open --with <people>` is what opens one, and a preview never does",
    ]);
  });
});

describe("destinationProblems — the places that are not a direct message", () => {
  it("says nothing about a well-formed channel", () => {
    expect(
      destinationProblems({
        destination: {
          channel: "C01SDLC",
          kind: "channel",
          label: "Post it to #delivery",
          tradeoff: "everyone sees it",
        },
      }),
    ).toEqual([]);
  });

  it("refuses a destination carrying no trade-off, since every option on a card says what it costs", () => {
    expect(
      destinationProblems({
        destination: { channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "  " },
      }),
    ).toEqual(["the channel carries no trade-off — every option on a card says what it costs"]);
  });

  // Its label is drawn as an option sentence beside the positional letter, so a typed one draws two.
  it("refuses a label that opens with its own option letter, and keeps one opening on the word A", () => {
    const channel = { channel: "C01SDLC", kind: "channel", tradeoff: "everyone sees it" } as const;
    expect([
      destinationLetterProblem({ destination: { ...channel, label: "C · Post it to #delivery" } }),
      destinationLetterProblem({ destination: { ...channel, label: "A separate post in #delivery" } }),
    ]).toEqual([
      `the channel's label opens with its own letter "C", but options are lettered by position, so the card would ` +
        "draw two — drop the letter, and name an option in `--lean` by the letter its position gives it",
      undefined,
    ]);
  });

  // A write-side rule, so a destination already on disk keeps reading as it did.
  it("leaves a lettered label out of the rules a stored destination is read against", () => {
    const channel = { channel: "C01SDLC", kind: "channel", tradeoff: "everyone sees it" } as const;
    expect(destinationProblems({ destination: { ...channel, label: "C · Post it to #delivery" } })).toEqual([]);
  });

  it("refuses an instant where a thread root wants a ts", () => {
    expect(
      destinationProblems({
        destination: {
          channel: "C01SDLC",
          kind: "thread",
          label: "Reply in the thread",
          threadTs: "2026-09-22T11:01:43.217Z",
          tradeoff: "only the people already in it see it",
        },
      }),
    ).toEqual(["2026-09-22T11:01:43.217Z is not a Slack ts — a reply binds to the thread root by its own id"]);
  });
});
