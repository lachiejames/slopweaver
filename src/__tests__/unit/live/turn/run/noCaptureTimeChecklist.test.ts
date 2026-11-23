import { describe, expect, it } from "vitest";

import { MENTION, PROVENANCE } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn without a capture-time checklist — unchanged", () => {
  it("still calls postWorking exactly once, the ordinary path", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });

    expect(log.filter((entry) => entry.kind === "post-working").length).toBe(1);
  });
});
