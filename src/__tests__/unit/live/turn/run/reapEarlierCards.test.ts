import { describe, expect, it } from "vitest";

import type { PostedRef } from "../../../../../live/turn/run.js";
import { answered, answerTs, MENTION, withheldOf } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

/**
 * Owner standing rule: once a real answer posts, every card an earlier turn on the same ask left in
 * the thread is deleted. MEASURED: a refused turn's checklist and failure card stood above the later
 * answer for 22 hours. `live/turn/earlierCards.ts` carries the incident; this pins the ordering and the edges.
 */
describe("a posted answer reaps every card its ask published before it", () => {
  const EARLIER: readonly PostedRef[] = [
    { channel: "C1", ts: "1712345600.000100" },
    { channel: "C1", ts: "1712345600.000200" },
  ];

  it("deletes each earlier card, in order, only AFTER the answer posted", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      earlierCards: EARLIER,
      mention: MENTION,
      poster: recordingPoster({ log }),
      query: fakeQuery({ phases: [] }),
    });

    const kinds = log.map((entry) => entry.kind);
    expect(answered(outcome)).toBe(true);
    expect(log.filter((entry) => entry.kind === "reap").map((entry) => entry.ts)).toEqual([
      "1712345600.000100",
      "1712345600.000200",
    ]);
    expect(kinds.indexOf("reap")).toBeGreaterThan(kinds.indexOf("post-answer"));
    expect(outcome.secondaryFailures).toEqual([]);
  });

  it("never reaps this turn's own working message or its own answer, whatever the caller passed", async () => {
    const log: Recorded[] = [];
    await drive({
      earlierCards: [
        { channel: "C1", ts: "1712345678.000300" },
        { channel: "C1", ts: "1712345678.000400" },
        { channel: "C1", ts: "1712345600.000100" },
      ],
      mention: MENTION,
      poster: recordingPoster({ log }),
      query: fakeQuery({ phases: [] }),
    });

    expect(log.filter((entry) => entry.kind === "reap").map((entry) => entry.ts)).toEqual(["1712345600.000100"]);
  });

  it("reaps nothing when the door WITHHELD the answer — nothing replaced those cards", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      earlierCards: EARLIER,
      mention: MENTION,
      poster: recordingPoster({ log, withhold: { code: "WITHHELD", reason: "held for review" } }),
      query: fakeQuery({ phases: [] }),
    });

    expect(withheldOf(outcome)!.code).toBe("WITHHELD");
    expect(log.filter((entry) => entry.kind === "reap")).toEqual([]);
  });

  it("reaps nothing when the answer post itself broke", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      earlierCards: EARLIER,
      mention: MENTION,
      poster: recordingPoster({ log, postAnswerThrows: new Error("chat.postMessage: fatal_error") }),
      query: fakeQuery({ phases: [] }),
    });

    expect(outcome.primary.kind).toBe("answer-lost");
    expect(log.filter((entry) => entry.kind === "reap")).toEqual([]);
  });

  it("names a card that would not delete on the completion, and still answers", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      earlierCards: EARLIER,
      mention: MENTION,
      poster: recordingPoster({ log, reapFails: ["1712345600.000200"] }),
      query: fakeQuery({ phases: [] }),
    });

    expect(answerTs(outcome)).toBe("1712345678.000400");
    expect(outcome.secondaryFailures).toEqual([
      {
        kind: "reap",
        reason:
          "an earlier card on this ask in C1 (ts 1712345600.000200) could not be deleted after the answer posted — " +
          "it still stands above the answer; delete it by hand",
      },
    ]);
  });
});
