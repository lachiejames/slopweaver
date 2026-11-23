import { describe, expect, it } from "vitest";

import { type ReactionCount, tallyPoll } from "../../../../outbound/slack/pollResults.js";

const OPTIONS = ["Waiting on someone", "Fighting CI", "Other — explain in replies"];
const EMOJI = ["one", "two", "three"];
/** slopweaver's own user id — present in every option it seeded, and never a voter. */
const SELF = "U0BOT";

/** A live reaction whose voter list is COMPLETE (the measured normal case). */
function reaction({ name, users }: { name: string; users: readonly string[] }): ReactionCount {
  return { count: users.length, name, users };
}

describe("tallyPoll", () => {
  it("excludes slopweaver's own seed chip, so an unvoted poll reads as ZERO not one", () => {
    // Every option carries exactly the bot's chip. Counting reactions rather than VOTERS would report three
    // votes nobody cast — the single most likely way a seeded poll lies.
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: EMOJI.map((name) => reaction({ name, users: [SELF] })),
      selfUserId: SELF,
    });

    expect(tally.options.map((option) => option.votes)).toEqual([0, 0, 0]);
    expect(tally.totalVotes).toBe(0);
    expect(tally.options.map((option) => option.seeded)).toEqual([true, true, true]);
  });

  it("counts each distinct human voter exactly once, alongside the seed", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [
        reaction({ name: "one", users: [SELF, "U0AAA", "U0BBB"] }),
        reaction({ name: "two", users: [SELF] }),
        reaction({ name: "three", users: [SELF, "U0AAA"] }),
      ],
      selfUserId: SELF,
    });

    expect(tally.options).toEqual([
      { emojiName: "one", label: OPTIONS[0], position: 1, seeded: true, voterListTruncated: false, votes: 2 },
      { emojiName: "two", label: OPTIONS[1], position: 2, seeded: true, voterListTruncated: false, votes: 0 },
      { emojiName: "three", label: OPTIONS[2], position: 3, seeded: true, voterListTruncated: false, votes: 1 },
    ]);
    expect(tally.totalVotes).toBe(3);
  });

  it("counts a human vote on an option slopweaver never seeded", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [reaction({ name: "two", users: ["U0AAA", "U0BBB"] })],
      selfUserId: SELF,
    });

    expect(tally.options.map((option) => option.votes)).toEqual([0, 2, 0]);
    expect(tally.options[1]!.seeded).toBe(false);
  });

  it("stays correct when someone REMOVES slopweaver's own chip", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [reaction({ name: "one", users: ["U0AAA"] })],
      selfUserId: SELF,
    });

    expect(tally.options[0]!.votes).toBe(1);
    expect(tally.options[0]!.seeded).toBe(false);
  });

  it("falls back to the count, less our own chip, when Slack TRUNCATES the voter list", () => {
    // `users.length !== count` is how truncation is detectable at all. 9 reactors, only 2 listed, one of them us.
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [{ count: 9, name: "one", users: [SELF, "U0AAA"] }],
      selfUserId: SELF,
    });

    expect(tally.options[0]!.votes).toBe(8);
    expect(tally.options[0]!.voterListTruncated).toBe(true);
  });

  it("flags truncation ONLY on the option it happened to", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [{ count: 9, name: "one", users: [SELF] }, reaction({ name: "two", users: [SELF, "U0AAA"] })],
      selfUserId: SELF,
    });

    expect(tally.options.map((option) => option.voterListTruncated)).toEqual([true, false, false]);
  });

  it("is INDEPENDENT of the order Slack returns the reactions in", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [
        reaction({ name: "three", users: [SELF, "U0AAA", "U0BBB"] }),
        reaction({ name: "one", users: [SELF, "U0CCC"] }),
      ],
      selfUserId: SELF,
    });

    expect(tally.options.map((option) => option.votes)).toEqual([1, 0, 2]);
  });

  it("ignores an off-ballot reaction but REPORTS it", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [reaction({ name: "one", users: [SELF, "U0AAA"] }), reaction({ name: "eyes", users: ["U0BBB"] })],
      selfUserId: SELF,
    });

    expect(tally.totalVotes).toBe(1);
    expect(tally.ignored.map((entry) => entry.name)).toEqual(["eyes"]);
  });

  it("never counts :zero: as a vote, since options are numbered from one", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [reaction({ name: "zero", users: ["U0AAA", "U0BBB"] })],
      selfUserId: SELF,
    });

    expect(tally.totalVotes).toBe(0);
    expect(tally.ignored.map((entry) => entry.name)).toEqual(["zero"]);
  });

  it("counts against the ballot AS POSTED, even when it differs from today's palette", () => {
    const tally = tallyPoll({
      emojiNames: ["uno", "dos"],
      options: ["A", "B"],
      reactions: [reaction({ name: "dos", users: ["U0AAA"] }), reaction({ name: "one", users: ["U0BBB"] })],
      selfUserId: SELF,
    });

    expect(tally.options.map((option) => option.votes)).toEqual([0, 1]);
    expect(tally.ignored.map((entry) => entry.name)).toEqual(["one"]);
  });

  it("merges a name Slack somehow reported twice rather than discarding the second", () => {
    const tally = tallyPoll({
      emojiNames: EMOJI,
      options: OPTIONS,
      reactions: [reaction({ name: "one", users: ["U0AAA"] }), reaction({ name: "one", users: ["U0BBB"] })],
      selfUserId: SELF,
    });

    expect(tally.options[0]!.votes).toBe(2);
  });

  it("reports zero for every option when there are no reactions at all", () => {
    const tally = tallyPoll({ emojiNames: EMOJI, options: OPTIONS, reactions: [], selfUserId: SELF });

    expect(tally.options.map((option) => option.votes)).toEqual([0, 0, 0]);
    expect(tally.ignored).toEqual([]);
  });
});
