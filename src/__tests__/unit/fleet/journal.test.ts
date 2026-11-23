/**
 * The recovery journal's decode and fold: the only channel from the in-cmux pass to the page outside it.
 */
import { describe, expect, it } from "vitest";

import { foldNewestAttempt, parseFleetJournal, reorientationsBySession } from "../../../fleet/journal.js";

/** One journal line at schema version 1. */
const line = (fields: Record<string, unknown>): string => JSON.stringify({ schemaVersion: 1, ...fields });

describe("parseFleetJournal", () => {
  it("counts a cut first line and a foreign line as unreadable rather than dropping them silently", () => {
    const text = [
      'ptId":"x"}',
      line({ atIso: "t1", attemptId: "a", episodeId: "e", kind: "attempt-started", pid: 7 }),
      line({ kind: "something-else" }),
      "",
    ].join("\n");
    const read = parseFleetJournal({ text });
    expect(read.events.length).toBe(1);
    expect(read.unreadable).toBe(2);
  });

  it("keeps a refusal code this build cannot name as UNKNOWN with the original beside it", () => {
    const text = line({
      atIso: "t1",
      attemptId: "a",
      kind: "attempt-finished",
      outcome: "failed",
      refusal: { code: "NEW_GATE", message: "no" },
    });
    const event = parseFleetJournal({ text }).events[0]!;
    expect(event).toEqual({
      atIso: "t1",
      attemptId: "a",
      kind: "attempt-finished",
      outcome: "failed",
      refusal: { code: "UNKNOWN", message: "no", originalCode: "NEW_GATE" },
      schemaVersion: 1,
    });
  });
});

describe("foldNewestAttempt", () => {
  it("folds only the newest attempt, and counts a reorientation only for the session it awaited", () => {
    const text = [
      line({ atIso: "t1", attemptId: "old", episodeId: "e", kind: "attempt-started", pid: 1 }),
      line({ atIso: "t2", attemptId: "old", kind: "chair-reoriented", chairSessionId: "chair" }),
      line({ atIso: "t3", attemptId: "new", episodeId: "e", kind: "attempt-started", pid: 2 }),
      line({
        atIso: "t4",
        attemptId: "new",
        chairSessionId: "chair",
        chairWorkspaceId: "ws",
        kind: "chair-awaiting-reorientation",
      }),
      line({ atIso: "t5", attemptId: "new", chairSessionId: "someone-else", kind: "chair-reoriented" }),
    ].join("\n");
    const fold = foldNewestAttempt({ events: parseFleetJournal({ text }).events })!;
    expect(fold.attemptId).toBe("new");
    expect(fold.pid).toBe(2);
    expect(fold.chair).toEqual({ chairSessionId: "chair", chairWorkspaceId: "ws", kind: "awaiting" });
  });

  it("marks the chair reoriented on its own line", () => {
    const text = [
      line({ atIso: "t3", attemptId: "new", episodeId: "e", kind: "attempt-started", pid: 2 }),
      line({
        atIso: "t4",
        attemptId: "new",
        chairSessionId: "chair",
        chairWorkspaceId: "ws",
        kind: "chair-awaiting-reorientation",
      }),
      line({ atIso: "t5", attemptId: "new", chairSessionId: "chair", kind: "chair-reoriented" }),
    ].join("\n");
    const events = parseFleetJournal({ text }).events;
    expect(foldNewestAttempt({ events })!.chair).toEqual({ atIso: "t5", chairSessionId: "chair", kind: "reoriented" });
    expect(reorientationsBySession({ events }).get("chair")).toBe("t5");
  });

  it("is undefined when no attempt ever started", () => {
    expect(foldNewestAttempt({ events: [] })).toBeUndefined();
  });
});
