import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { runTurn } from "../../../../../live/turn/run.js";
import { answered, answerTs, MENTION, PROVENANCE } from "./fixtures.js";
import { fakeQuery, NULL_COMPLETE, NULL_HOLD, NULL_SUPERSESSION, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn with a capture-time checklist already posted", () => {
  const STARTED = { turnId: "turn-1", workingTs: "1712345678.000900" };

  it("reconstructs the posted reference and NEVER calls postWorking — exactly one working message per turn", async () => {
    const log: Recorded[] = [];
    const outcome = unwrap(
      await runTurn({
        documents: [],
        supersession: NULL_SUPERSESSION,
        earlierCards: [],
        complete: NULL_COMPLETE,
        hold: NULL_HOLD,
        mention: MENTION,
        poster: recordingPoster({ log }),
        provenance: PROVENANCE,
        query: fakeQuery({ phases: ["loaded"] }),
        started: STARTED,
        turnId: "turn-test",
        uploads: [],
      }),
    );

    expect(log.some((entry) => entry.kind === "post-working")).toBe(false);
    expect(outcome.workingTs).toBe(STARTED.workingTs);
  });

  it("posts a fresh checklist when the remembered capture-time message is gone, and still answers", async () => {
    // An earlier turn on this ask already answered, so its reply replaced the capture-time checklist; the
    // ask log still remembers the ref. Measured live: the advance hit message_not_found and the
    // whole turn died before postAnswer. The remembered ref names nothing, so a fresh checklist is the only one.
    const log: Recorded[] = [];
    const outcome = unwrap(
      await runTurn({
        documents: [],
        supersession: NULL_SUPERSESSION,
        earlierCards: [],
        complete: NULL_COMPLETE,
        hold: NULL_HOLD,
        mention: MENTION,
        poster: recordingPoster({ advanceGoneOnce: true, log }),
        provenance: PROVENANCE,
        query: fakeQuery({ phases: ["loaded"] }),
        started: STARTED,
        turnId: "turn-test",
        uploads: [],
      }),
    );

    expect(log.filter((entry) => entry.kind === "post-working").length).toBe(1);
    expect(log.some((entry) => entry.kind === "post-answer")).toBe(true);
    expect(answered(outcome)).toBe(true);
    expect(outcome.workingTs).toBe("1712345678.000300");
  });

  it("still surfaces an advance failure that is NOT the message being gone", async () => {
    const log: Recorded[] = [];
    await expect(
      runTurn({
        documents: [],
        earlierCards: [],
        supersession: NULL_SUPERSESSION,
        complete: NULL_COMPLETE,
        hold: NULL_HOLD,
        mention: MENTION,
        poster: recordingPoster({ advanceThrows: new Error("ratelimited"), log }),
        provenance: PROVENANCE,
        query: fakeQuery({ phases: ["loaded"] }),
        started: STARTED,
        turnId: "turn-test",
        uploads: [],
      }),
    ).rejects.toThrow("ratelimited");
    expect(log.some((entry) => entry.kind === "post-working")).toBe(false);
  });

  it("sends every phase advance to the reconstructed message, then deletes it, same as an ordinary turn", async () => {
    const log: Recorded[] = [];
    await runTurn({
      documents: [],
      earlierCards: [],
      supersession: NULL_SUPERSESSION,
      complete: NULL_COMPLETE,
      hold: NULL_HOLD,
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
      started: STARTED,
      turnId: "turn-test",
      uploads: [],
    });

    // One MORE than the phase count: the first is the tier correction `beginTurn` sends before the query
    // ever runs (see its own doc), and the remaining two are the phases `fakeQuery` fires via `onPhase`.
    expect(log.filter((entry) => entry.kind === "advance").length).toBe(3);
    expect(log.filter((entry) => entry.kind === "delete-working").length).toBe(1);
  });

  it("corrects the capture-time placeholder to the tier's real steps BEFORE the query ever runs", async () => {
    const log: Recorded[] = [];
    await runTurn({
      documents: [],
      earlierCards: [],
      supersession: NULL_SUPERSESSION,
      complete: NULL_COMPLETE,
      hold: NULL_HOLD,
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["answered via `slopweaver fleet status`"] }),
      started: STARTED,
      tier: "read-only-subagent",
      turnId: "turn-test",
      uploads: [],
    });

    // The correction is the FIRST advance, before begin-status or the query's own onPhase-driven one — a
    // read-only-subagent tier never shows inline language even for the instant before its own real step is
    // known done. Asserted on `ids` rather than `states`: `PENDING_ROUTE_STEPS` and `SUBAGENT_TURN_STEPS` are
    // both two steps reading `["done", "running"]` at this cursor position, so only the step identity tells
    // them apart.
    const firstAdvance = log.find((entry) => entry.kind === "advance");
    expect(firstAdvance!.ids).toEqual(["question", "investigate"]);
    expect(firstAdvance!.states).toEqual(["done", "running"]);
    expect(log.map((entry) => entry.kind)).toEqual([
      "advance",
      "begin-status",
      "advance",
      "post-answer",
      "end-status",
      "delete-working",
      "settle-reaction",
    ]);
  });

  it("still answers, and the answer posts as usual", async () => {
    const outcome = unwrap(
      await runTurn({
        documents: [],
        supersession: NULL_SUPERSESSION,
        earlierCards: [],
        complete: NULL_COMPLETE,
        hold: NULL_HOLD,
        mention: MENTION,
        poster: recordingPoster({ log: [] }),
        provenance: PROVENANCE,
        query: fakeQuery({ phases: [] }),
        started: STARTED,
        turnId: "turn-test",
        uploads: [],
      }),
    );

    expect(answered(outcome)).toBe(true);
    expect(answerTs(outcome)).toBe("1712345678.000400");
  });
});
