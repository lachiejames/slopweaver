import { describe, expect, it } from "vitest";

import { TURN_STATUS_TEXT, type TurnQuery } from "../../../../../live/turn/run.js";
import { ANSWER, answered, answerTs, COVERAGE, MENTION, PROVENANCE } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn ordering", () => {
  it("posts the working message BEFORE the query starts", async () => {
    const log: Recorded[] = [];
    let postedBeforeQuery = false;
    const query: TurnQuery = async () => {
      postedBeforeQuery = log.map((entry) => entry.kind).includes("post-working");
      return { answer: ANSWER, completionDetail: "done", coverage: COVERAGE };
    };
    await drive({ mention: MENTION, poster: recordingPoster({ log }), provenance: PROVENANCE, query });
    expect(postedBeforeQuery).toBe(true);
  });

  it("sets the native status indicator BEFORE the query starts too — investigation, not just the checklist", async () => {
    const log: Recorded[] = [];
    let statusSetBeforeQuery = false;
    const query: TurnQuery = async () => {
      statusSetBeforeQuery = log.map((entry) => entry.kind).includes("begin-status");
      return { answer: ANSWER, completionDetail: "done", coverage: COVERAGE };
    };
    await drive({ mention: MENTION, poster: recordingPoster({ log }), provenance: PROVENANCE, query });
    expect(statusSetBeforeQuery).toBe(true);
    expect(log.find((entry) => entry.kind === "begin-status")!.status).toBe(TURN_STATUS_TEXT);
  });

  it("acknowledges with the question already read, so no frame is ever untrue", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });
    expect(log[0]!.states).toEqual(["done", "running"]);
  });

  it("advances the checklist once per phase, in place", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(log.map((entry) => entry.kind)).toEqual([
      "post-working",
      "begin-status",
      "advance",
      "advance",
      "post-answer",
      "end-status",
      "delete-working",
      "settle-reaction",
    ]);
  });

  it("shows the checklist genuinely moving across its one advance — no live route fires more than one phase", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["answered from context"] }),
    });
    const advance = log.find((entry) => entry.kind === "advance");
    expect(advance!.states).toEqual(["done", "done"]);
  });

  it("posts the answer BEFORE deleting the working message — a real reply replaces it, never edits it done", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    const kinds = log.map((entry) => entry.kind);
    expect(kinds.indexOf("post-answer")).toBeLessThan(kinds.indexOf("delete-working"));
  });

  it("finishes the checklist in place, fully done, when the delete itself fails", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ deleteWorkingFails: true, log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(log.map((entry) => entry.kind)).toEqual([
      "post-working",
      "begin-status",
      "advance",
      "advance",
      "post-answer",
      "end-status",
      "delete-working",
      "finalize",
      "settle-reaction",
    ]);
    expect(log.findLast((entry) => entry.kind === "finalize")!.states).toEqual(["done", "done"]);
  });

  it("returns the timestamps of both messages", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded"] }),
    });
    expect(answered(outcome)).toBe(true);
    expect(outcome.workingTs).toBe("1712345678.000300");
    expect(answerTs(outcome)).toBe("1712345678.000400");
  });
});
