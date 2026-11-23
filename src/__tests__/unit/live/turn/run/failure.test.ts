import { describe, expect, it } from "vitest";

import type { TurnQuery } from "../../../../../live/turn/run.js";
import { answered, failureReason, MENTION, PROVENANCE } from "./fixtures.js";
import { drive, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn failure", () => {
  const broken: TurnQuery = async ({ onPhase }) => {
    await onPhase({ detail: "loaded" });
    throw new Error("the corpus is unreadable");
  };

  it("marks the reached step failed and still posts a card", async () => {
    const log: Recorded[] = [];
    // Breaks BEFORE any phase, unlike `broken` — with a two-step checklist, a phase call already exhausts
    // `completed`, leaving no step left running for a later failure to mark. This is the only shape that
    // still leaves the second step "running" for the failure to land on.
    const brokenBeforeAnyPhase: TurnQuery = async () => {
      throw new Error("the required surface could not be reached");
    };
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: brokenBeforeAnyPhase,
    });
    expect(log.map((entry) => entry.kind)).toEqual([
      "post-working",
      "begin-status",
      "end-status",
      "finalize",
      "settle-reaction",
      "post-notice",
    ]);
    expect(log.findLast((entry) => entry.kind === "finalize")!.states).toEqual(["done", "failed"]);
  });

  it("clears the status indicator on the failure path too, before the failure notice posts", async () => {
    const log: Recorded[] = [];
    await drive({ mention: MENTION, poster: recordingPoster({ log }), provenance: PROVENANCE, query: broken });
    const endAt = log.map((entry) => entry.kind).indexOf("end-status");
    const noticeAt = log.map((entry) => entry.kind).indexOf("post-notice");
    expect(endAt).toBeGreaterThan(-1);
    expect(endAt).toBeLessThan(noticeAt);
  });

  it("resolves with the reason rather than rejecting, so a listener cannot swallow it", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: broken,
    });
    expect(answered(outcome)).toBe(false);
    expect(failureReason(outcome)).toBe("the corpus is unreadable");
  });

  it("posts a card that says it could not answer, not a confident one", async () => {
    const log: Recorded[] = [];
    await drive({ mention: MENTION, poster: recordingPoster({ log }), provenance: PROVENANCE, query: broken });
    expect(log.at(-1)!.lead).toBe(
      'Something broke while I was answering "what did we decide about the renderer?". Nothing was posted.',
    );
  });

  it("reports a non-Error throw without pretending it was one", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: async () => {
        throw "socket closed";
      },
    });
    expect(failureReason(outcome)).toBe("socket closed");
  });
});
