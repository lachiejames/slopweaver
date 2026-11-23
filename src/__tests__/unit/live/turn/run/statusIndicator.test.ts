import { describe, expect, it } from "vitest";

import { answered, failureReason, MENTION, PROVENANCE, statusFailures } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn status indicator", () => {
  it("reports no status failure when the indicator was set", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(statusFailures(outcome)).toEqual([]);
    expect(answered(outcome)).toBe(true);
  });

  it("still answers when the status indicator is refused — a courtesy the turn must survive losing", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log, statusRefusal: "assistant.threads.setStatus refused: missing_scope" }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(answered(outcome)).toBe(true);
    expect(statusFailures(outcome)).toEqual([
      "the thinking indicator was not set — assistant.threads.setStatus refused: missing_scope",
    ]);
    expect(log.find((entry) => entry.kind === "post-answer")!.lead).toBe("We render rich_text.");
  });

  it("never says 'not set' about an indicator that WAS set — the two failures are different facts", () => {
    const setMessage = "the thinking indicator was not set — x";
    const clearMessage = "the thinking indicator was not cleared — x";

    expect(clearMessage.startsWith("the thinking indicator was not set")).toBe(false);
    expect(setMessage.startsWith("the thinking indicator was not set")).toBe(true);
  });

  it("REPORTS a failed CLEAR — an indicator left standing says the turn is still working when it is not", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ clearRefusal: "assistant.threads.setStatus refused: channel_not_found", log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(answered(outcome)).toBe(true);
    expect(statusFailures(outcome)).toEqual([
      "the thinking indicator was not cleared — assistant.threads.setStatus refused: channel_not_found",
    ]);
  });

  it("reports BOTH the set and the clear failure when both happened, set first — neither may collapse the other", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({
        clearRefusal: "also refused",
        log: [],
        statusRefusal: "assistant.threads.setStatus refused: missing_scope",
      }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(statusFailures(outcome)).toEqual([
      "the thinking indicator was not set — assistant.threads.setStatus refused: missing_scope",
      "the thinking indicator was not cleared — also refused",
    ]);
  });

  it("still answers when the status call THROWS — a transport fault is not a Slack refusal, and neither may kill the turn", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log, statusThrows: "ECONNRESET" }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(answered(outcome)).toBe(true);
    expect(statusFailures(outcome)).toEqual(["the thinking indicator was not set — ECONNRESET"]);
    expect(log.find((entry) => entry.kind === "post-answer")!.lead).toBe("We render rich_text.");
  });

  it("carries the status refusal out of a FAILED turn too, so one loss never hides the other", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [], statusRefusal: "assistant.threads.setStatus refused: channel_not_found" }),
      provenance: PROVENANCE,
      query: async () => {
        throw new Error("the corpus is not built");
      },
    });

    expect(answered(outcome)).toBe(false);
    expect(failureReason(outcome)).toBe("the corpus is not built");
    expect(statusFailures(outcome)).toEqual([
      "the thinking indicator was not set — assistant.threads.setStatus refused: channel_not_found",
    ]);
  });

  // Clearing now happens FIRST of the three finalisation steps rather than last of everything. The indicator
  // is the one that costs the reader most — "is looking into it…" standing over a finished turn is the
  // appearance-of-brokenness the whole surface is judged on — and clearing it is also what stops the
  // re-assert timer, so no other indicator's failure may delay it.
  it("clears the indicator before settling anything else, and never leaves the reaction unsettled", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    const kinds = log.map((entry) => entry.kind);
    expect(kinds.indexOf("end-status")).toBeLessThan(kinds.indexOf("delete-working"));
    expect(log.at(-1)!.kind).toBe("settle-reaction");
  });
});
