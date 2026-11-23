import { describe, expect, it } from "vitest";

import { answered, DM_MENTION, failureReason, MENTION, PROVENANCE, titleFailure } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn thread title", () => {
  it("names the thread BEFORE anything is posted into it, so the container row is never anonymous", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: DM_MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(log[0]).toEqual({ kind: "set-title", title: "what did we decide about the renderer?" });
    expect(log[1]!.kind).toBe("post-working");
  });

  it("never names a CHANNEL thread, because there is no container row to name", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(log.filter((entry) => entry.kind === "set-title")).toEqual([]);
  });

  it("reports no title failure when the title was set", async () => {
    const outcome = await drive({
      mention: DM_MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(titleFailure(outcome)).toBe(undefined);
    expect(answered(outcome)).toBe(true);
  });

  it("still answers when the title is refused, and carries the refusal's reason out", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      mention: DM_MENTION,
      poster: recordingPoster({ log, titleRefusal: "assistant.threads.setTitle refused: missing_scope" }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(answered(outcome)).toBe(true);
    expect(titleFailure(outcome)).toBe("assistant.threads.setTitle refused: missing_scope");
    expect(log.find((entry) => entry.kind === "post-answer")!.lead).toBe("We render rich_text.");
  });

  it("carries the title refusal out of a FAILED turn too, so one loss never hides the other", async () => {
    const outcome = await drive({
      mention: DM_MENTION,
      poster: recordingPoster({ log: [], titleRefusal: "the admit door refused to name the thread" }),
      provenance: PROVENANCE,
      query: async () => {
        throw new Error("the corpus is not built");
      },
    });

    expect(answered(outcome)).toBe(false);
    expect(failureReason(outcome)).toBe("the corpus is not built");
    expect(titleFailure(outcome)).toBe("the admit door refused to name the thread");
  });
});
