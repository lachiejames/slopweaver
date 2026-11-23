import { describe, expect, it } from "vitest";

import {
  POLL_MAX_AUTHORED_OPTIONS,
  POLL_OPTION_EMOJI,
  POLL_OTHER_LABEL,
  pollArtifactSchema,
  pollBallot,
} from "../../../../outbound/slack/pollForm.js";

/** A well-formed poll with `n` distinct options, so a test can talk about counts without restating the shape. */
function pollOf({ count }: { count: number }): Record<string, unknown> {
  return {
    kind: "poll",
    options: Array.from({ length: count }, (_, index) => `Option ${String(index + 1)}`),
    question: "Where did the time go?",
    why: "Working out which friction to fix next.",
  };
}

/** The first issue's message for a rejected form. Resolved here, loudly, so no assertion needs a conditional. */
function firstIssueMessage({ input }: { input: unknown }): string {
  const parsed = pollArtifactSchema.safeParse(input);
  if (parsed.success) {
    throw new Error("expected the form to be REFUSED, but it parsed");
  }
  return parsed.error.issues[0]!.message;
}

/** The first issue's path for a rejected form. */
function firstIssuePath({ input }: { input: unknown }): readonly (string | number | symbol)[] {
  const parsed = pollArtifactSchema.safeParse(input);
  if (parsed.success) {
    throw new Error("expected the form to be REFUSED, but it parsed");
  }
  return parsed.error.issues[0]!.path;
}

describe("pollArtifactSchema", () => {
  it("accepts the minimum poll and preserves every field exactly", () => {
    const poll = pollArtifactSchema.parse(pollOf({ count: 2 }));

    expect(poll.kind).toBe("poll");
    expect(poll.question).toBe("Where did the time go?");
    expect(poll.why).toBe("Working out which friction to fix next.");
    expect(poll.options).toEqual(["Option 1", "Option 2"]);
  });

  it("accepts exactly four AUTHORED options — the fifth ballot slot is the escape hatch", () => {
    const poll = pollArtifactSchema.parse(pollOf({ count: POLL_MAX_AUTHORED_OPTIONS }));

    expect(poll.options.length).toBe(4);
  });

  it("refuses a fifth authored option and explains that the ballot appends one", () => {
    const message = firstIssueMessage({ input: pollOf({ count: 5 }) });

    expect(message).toContain("at most 4 authored options");
    expect(message).toContain(POLL_OTHER_LABEL);
  });

  it("refuses a single option — one option is a statement, not a poll", () => {
    expect(pollArtifactSchema.safeParse(pollOf({ count: 1 })).success).toBe(false);
  });

  it("refuses two options that differ only by case, because a voter cannot tell them apart", () => {
    const input = { ...pollOf({ count: 2 }), options: ["Meetings", "meetings"] };

    expect(firstIssueMessage({ input })).toContain("same once case is ignored");
    expect(firstIssuePath({ input })).toEqual(["options", 1]);
  });

  it("refuses duplicate options that differ only by surrounding whitespace", () => {
    const input = { ...pollOf({ count: 2 }), options: ["Meetings", "  Meetings  "] };

    expect(pollArtifactSchema.safeParse(input).success).toBe(false);
  });

  it("refuses a newline inside an option — it would detach a label from its emoji", () => {
    const input = { ...pollOf({ count: 2 }), options: ["Fine", "Broken\nacross lines"] };

    expect(firstIssueMessage({ input })).toContain("no line breaks");
  });

  it("refuses a newline inside the question", () => {
    const input = { ...pollOf({ count: 2 }), question: "Where did\nthe time go?" };

    expect(firstIssueMessage({ input })).toContain("no line breaks");
  });

  it("refuses a carriage return, not only a newline", () => {
    const input = { ...pollOf({ count: 2 }), question: "Where did\rthe time go?" };

    expect(pollArtifactSchema.safeParse(input).success).toBe(false);
  });

  it("refuses a U+2028 LINE SEPARATOR, which breaks a line just as a newline does", () => {
    // A break here would visually detach a label from the keycap above it, so a reader could see option 2
    // beside option 1's emoji and their vote would land on the wrong option.
    const input = { ...pollOf({ count: 2 }), options: ["Fine", "Broken\u2028across lines"] };

    expect(pollArtifactSchema.safeParse(input).success).toBe(false);
  });

  it("refuses U+2029, U+0085 and a vertical tab as line breaks", () => {
    for (const ch of ["\u2029", "\u0085", "\v", "\f"]) {
      expect(pollArtifactSchema.safeParse({ ...pollOf({ count: 2 }), question: `a${ch}b` }).success).toBe(false);
    }
  });

  it("refuses a whitespace-only question, because trimming happens before the emptiness check", () => {
    const input = { ...pollOf({ count: 2 }), question: "   " };

    expect(pollArtifactSchema.safeParse(input).success).toBe(false);
  });

  it("REFUSES an unknown key instead of silently dropping it", () => {
    // Hit for real: `mentions:` was passed instead of `ping:`. The form validated clean, the dry run rendered
    // clean, the poll posted fine, and the ping simply was not there — no error anywhere. A typo'd field name
    // has to fail at the door.
    const input = { ...pollOf({ count: 2 }), mentions: [{ kind: "broadcast", range: "channel" }] };

    expect(firstIssueMessage({ input })).toContain("Unrecognized key");
    expect(firstIssueMessage({ input })).toContain("mentions");
  });

  it("REFUSES an unknown key inside a ping, so a typo'd sub-field cannot vanish either", () => {
    const input = { ...pollOf({ count: 2 }), ping: [{ handel: "engineers", kind: "group" }] };

    expect(pollArtifactSchema.safeParse(input).success).toBe(false);
  });

  it("still accepts a correctly-spelled ping", () => {
    const input = { ...pollOf({ count: 2 }), ping: [{ handle: "engineers", kind: "group" }] };

    expect(pollArtifactSchema.safeParse(input).success).toBe(true);
  });

  it("refuses a missing why — a poll that is only a mechanism is a bounce", () => {
    const { why: _why, ...withoutWhy } = pollOf({ count: 2 });

    expect(pollArtifactSchema.safeParse(withoutWhy).success).toBe(false);
  });

  it("trims surrounding whitespace off every field", () => {
    const poll = pollArtifactSchema.parse({
      kind: "poll",
      options: ["  Waiting  ", "\tCI\t"],
      question: "  Where did the time go?  ",
      why: "  Because.  ",
    });

    expect(poll.question).toBe("Where did the time go?");
    expect(poll.why).toBe("Because.");
    expect(poll.options).toEqual(["Waiting", "CI"]);
  });

  it("refuses a question of 301 characters and accepts one of 300", () => {
    expect(pollArtifactSchema.safeParse({ ...pollOf({ count: 2 }), question: "q".repeat(301) }).success).toBe(false);
    expect(pollArtifactSchema.safeParse({ ...pollOf({ count: 2 }), question: "q".repeat(300) }).success).toBe(true);
  });

  it("refuses an option of 121 characters and accepts one of 120", () => {
    const over = { ...pollOf({ count: 2 }), options: ["fine", "o".repeat(121)] };
    const at = { ...pollOf({ count: 2 }), options: ["fine", "o".repeat(120)] };

    expect(pollArtifactSchema.safeParse(over).success).toBe(false);
    expect(pollArtifactSchema.safeParse(at).success).toBe(true);
  });
});

describe("pollBallot", () => {
  it("appends the escape hatch as the LAST option, so every poll can say none-of-these", () => {
    const ballot = pollBallot({ options: ["Waiting on someone", "Fighting CI"] });

    expect(ballot).toEqual([
      { emojiName: "one", label: "Waiting on someone", position: 1 },
      { emojiName: "two", label: "Fighting CI", position: 2 },
      { emojiName: "three", label: POLL_OTHER_LABEL, position: 3 },
    ]);
  });

  it("points the escape hatch at the thread, because the point is discussion not just a tally", () => {
    expect(POLL_OTHER_LABEL).toContain("explain in replies");
  });

  it("fills the whole five-chip ballot from four authored options", () => {
    const ballot = pollBallot({ options: ["a", "b", "c", "d"] });

    expect(ballot.length).toBe(5);
    expect(ballot.map((entry) => entry.emojiName)).toEqual([...POLL_OPTION_EMOJI]);
    expect(ballot[4]!.label).toBe(POLL_OTHER_LABEL);
  });

  it("never emits `zero`, so a :zero: reaction can never be a vote", () => {
    expect(pollBallot({ options: ["a", "b", "c", "d"] }).map((entry) => entry.emojiName)).not.toContain("zero");
  });

  it("throws past the ballot size rather than yielding an option nobody can vote for", () => {
    expect(() => pollBallot({ options: ["a", "b", "c", "d", "e"] })).toThrow("no ballot emoji for option 6");
  });

  it("returns an empty ballot for no options rather than appending a lone escape hatch", () => {
    expect(pollBallot({ options: [] })).toEqual([]);
  });
});
