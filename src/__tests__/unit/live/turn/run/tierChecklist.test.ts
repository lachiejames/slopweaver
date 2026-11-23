import { describe, expect, it } from "vitest";

import { MENTION, PROVENANCE } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn tier-aware checklist", () => {
  it("shows the two inline steps by default, since no tier is decided yet", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["answered from context"] }),
    });
    const posted = log.find((entry) => entry.kind === "post-working");
    expect(posted!.states).toHaveLength(2);
  });

  it("shows the two read-only-subagent steps, never inline language, for that tier", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["answered via `slopweaver fleet status`"] }),
      tier: "read-only-subagent",
    });
    expect(log.map((entry) => entry.kind)).toEqual([
      "post-working",
      "begin-status",
      "advance",
      "post-answer",
      "end-status",
      "delete-working",
      "settle-reaction",
    ]);
    expect(log.find((entry) => entry.kind === "post-working")!.states).toEqual(["done", "running"]);
    expect(log.find((entry) => entry.kind === "advance")!.states).toEqual(["done", "done"]);
  });

  it("shows the two fresh-visible-session steps, never inline language, for that tier", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["the required surface could not be reached"] }),
      tier: "fresh-visible-session",
    });
    expect(log.find((entry) => entry.kind === "post-working")!.states).toEqual(["done", "running"]);
  });

  it("finishes a read-only-subagent turn's checklist fully done, in two steps not four, when the delete fails", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ deleteWorkingFails: true, log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["answered via `slopweaver fleet status`"] }),
      tier: "read-only-subagent",
    });
    expect(log.findLast((entry) => entry.kind === "finalize")!.states).toEqual(["done", "done"]);
  });
});
