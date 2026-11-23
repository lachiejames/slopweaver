/**
 * `reviewThroughput` — the clock, the parallel-read instruction, the re-review scope and the card's review
 * line. Pure: literals in, lines out.
 */
import { describe, expect, it } from "vitest";

import { answerChangeLines } from "../../../../live/turn/answerChange.js";
import {
  packetCarriesClock,
  parallelReadLines,
  ROUND_CLOCK_HEADING,
  reReviewScopeLines,
  reviewNowLine,
  roundClockLines,
} from "../../../../live/turn/reviewThroughput.js";

describe("roundClockLines", () => {
  it("opens on the heading the open verb checks for, and says round 1 is the first", () => {
    const lines = roundClockLines({
      reviewStartedAt: undefined,
      round: 1,
      spawnedAt: "2026-09-15T04:00:00.000Z",
    });

    expect(lines[0]).toBe(ROUND_CLOCK_HEADING);
    expect(lines[2]).toBe("Round 1 opened at 2026-09-15T04:00:00.000Z. This is the ask's first round.");
  });

  it("states the time already spent in review from round 1's own instant", () => {
    const lines = roundClockLines({
      reviewStartedAt: "2026-09-15T04:00:00.000Z",
      round: 3,
      spawnedAt: "2026-09-15T04:31:00.000Z",
    });

    expect(lines[2]).toBe(
      "Round 3 opened at 2026-09-15T04:31:00.000Z. This ask has already spent 31m in review across 2 earlier round(s).",
    );
  });

  it("says the start was not recorded rather than inventing one", () => {
    const lines = roundClockLines({
      reviewStartedAt: undefined,
      round: 2,
      spawnedAt: "2026-09-15T04:31:00.000Z",
    });

    expect(lines[2]).toBe(
      "Round 2 opened at 2026-09-15T04:31:00.000Z. 1 earlier round(s); when round 1 opened was not recorded.",
    );
  });

  it("carries the measured round cost and no deadline", () => {
    const text = roundClockLines({ reviewStartedAt: undefined, round: 1, spawnedAt: "x" }).join("\n");

    expect(text).toContain("a round took 5.7 to 23.2 minutes, median 12");
    expect(text).not.toContain("deadline");
  });
});

describe("packetCarriesClock", () => {
  it("is true only for a packet that carries the heading", () => {
    const packet = roundClockLines({ reviewStartedAt: undefined, round: 1, spawnedAt: "x" }).join("\n");

    expect(packetCarriesClock({ packet })).toBe(true);
    expect(packetCarriesClock({ packet: "# Review packet\n\nno clock here" })).toBe(false);
  });
});

describe("parallelReadLines", () => {
  it("orders enumerate, one parallel batch, then classify", () => {
    const text = parallelReadLines().join("\n");

    expect(text).toContain("write down every material claim BEFORE running anything");
    expect(text).toContain("in ONE batch — several tool calls in the same message");
    expect(text).toContain("it lowers no bar on what counts");
  });
});

describe("reReviewScopeLines", () => {
  const moved = [{ kind: "changed" as const, path: "/lead" }];

  it("renders nothing on round 1", () => {
    expect(reReviewScopeLines({ changeLines: ["x"], changes: moved, changesShown: false, round: 1 })).toStrictEqual([]);
  });

  it("prints the change list and scopes the round to it when no settled block printed it", () => {
    const text = reReviewScopeLines({
      changeLines: answerChangeLines({ changes: moved }),
      changes: moved,
      changesShown: false,
      round: 2,
    }).join("\n");

    expect(text).toContain("- `/lead` — changed");
    expect(text).toContain("every claim a changed path expresses or qualifies");
    expect(text).toContain("A claim resting on live state is re-read, never reused");
  });

  it("does not print the list twice when the settled block already did", () => {
    const text = reReviewScopeLines({
      changeLines: answerChangeLines({ changes: moved }),
      changes: moved,
      changesShown: true,
      round: 2,
    }).join("\n");

    expect(text).not.toContain("- `/lead` — changed");
    expect(text).toContain("every claim a changed path expresses or qualifies");
  });

  it("falls back to a FULL review when nothing says what moved", () => {
    const text = reReviewScopeLines({
      changeLines: answerChangeLines({ changes: undefined }),
      changes: undefined,
      changesShown: false,
      round: 2,
    }).join("\n");

    expect(text).toContain("This round is a FULL review");
    expect(text).toContain("NOT KNOWN");
  });

  it("falls back to a FULL review when the whole answer moved", () => {
    const whole = [{ kind: "changed" as const, path: "/" }];
    const text = reReviewScopeLines({ changeLines: [], changes: whole, changesShown: false, round: 3 }).join("\n");

    expect(text).toContain("This round is a FULL review");
  });
});

describe("reviewNowLine", () => {
  it("names the round and how long it has been open", () => {
    expect(
      reviewNowLine({
        nowIso: "2026-09-15T04:07:30.000Z",
        record: { round: 1, spawnedAt: "2026-09-15T04:00:00.000Z" },
      }),
    ).toBe("now: independent review, round 1 · open 7m");
  });

  it("adds the whole review phase from round 2 on", () => {
    expect(
      reviewNowLine({
        nowIso: "2026-09-15T04:40:00.000Z",
        record: { reviewStartedAt: "2026-09-15T04:00:00.000Z", round: 3, spawnedAt: "2026-09-15T04:31:00.000Z" },
      }),
    ).toBe("now: independent review, round 3 · open 9m · 40m in review so far");
  });

  it("omits the phase total when round 1's instant was never recorded", () => {
    expect(
      reviewNowLine({
        nowIso: "2026-09-15T04:40:00.000Z",
        record: { round: 2, spawnedAt: "2026-09-15T04:31:00.000Z" },
      }),
    ).toBe("now: independent review, round 2 · open 9m");
  });
});
