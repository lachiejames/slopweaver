/**
 * `slack poll`'s post-landing steps: the ballot is seeded in ballot order with each chip's outcome kept, and the
 * report names where the poll landed and the two follow-up verbs. Every seam is a plain function; no mocks.
 */
import { describe, expect, it } from "vitest";

import { reportPosted, seedBallot } from "../../../../../cli/commands/slack/pollBallot.js";

const POSTED = { channel: "C0FIXTURE01", ts: "1700000000.000100" };

const BALLOT = [
  { emojiName: "one", label: "Ship it", position: 1 },
  { emojiName: "two", label: "Hold it", position: 2 },
  { emojiName: "three", label: "Drop it", position: 3 },
];

describe("seedBallot", () => {
  it("seeds every chip in ballot order and splits the landed from the refused", async () => {
    const asked: string[] = [];
    const seeded = await seedBallot({
      plan: { ballot: BALLOT },
      posted: POSTED,
      seedReaction: async ({ name }) => {
        asked.push(name);
        return name !== "two";
      },
      token: "xoxb-FIXTURE",
    });
    expect(asked).toEqual(["one", "two", "three"]);
    expect(seeded).toEqual({ failedEmoji: ["two"], seededEmoji: ["one", "three"] });
  });

  it("seeds nothing for an empty ballot", async () => {
    const seeded = await seedBallot({
      plan: { ballot: [] },
      posted: POSTED,
      seedReaction: async () => true,
      token: "xoxb-FIXTURE",
    });
    expect(seeded).toEqual({ failedEmoji: [], seededEmoji: [] });
  });
});

describe("reportPosted", () => {
  it("names where the poll landed, the seeded count, and the results and delete verbs", () => {
    const lines: string[] = [];
    reportPosted({
      ballotSize: 3,
      emit: (line) => {
        lines.push(line);
      },
      failedEmoji: [],
      posted: POSTED,
      seededEmoji: ["one", "two", "three"],
    });
    expect(lines).toEqual([
      "posted poll to C0FIXTURE01 as ts 1700000000.000100",
      "seeded 3/3 clickable ballot chips",
      "read the votes back with:",
      "  slopweaver slack poll results --channel C0FIXTURE01 --ts 1700000000.000100",
      "delete it with:",
      "  slopweaver slack delete --channel C0FIXTURE01 --ts 1700000000.000100",
    ]);
  });
});
