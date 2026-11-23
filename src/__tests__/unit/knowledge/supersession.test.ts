/**
 * Retirement, the pure half: a later recording naming a claim retires it, a later recording OF that claim
 * brings it back, and the store-edge check refuses a target that is missing or of another kind.
 */
import { describe, expect, it } from "vitest";

import { KnowledgeErrors } from "../../../knowledge/errors.js";
import type { MemoryRecording } from "../../../knowledge/memory.js";
import { retiredClaimIds, supersessionCheck, withoutRetired } from "../../../knowledge/supersession.js";
import { err, ok, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

/** One recording as the pure readers see it. */
const rec = ({ id, supersedes }: { id: string; supersedes?: string }): { id: string; supersedes?: string } =>
  supersedes === undefined ? { id } : { id, supersedes };

const OLD = rec({ id: "l-old" });
const NEW_RETIRING_OLD = rec({ id: "l-new", supersedes: "l-old" });

/** A new lesson recording that retires `l-old`. */
const replacement = (over: Partial<MemoryRecording> = {}): MemoryRecording => ({
  behaviourChange: null,
  caveat: null,
  claim: "the pool exhausts on staging only",
  domain: "store",
  evidence: "k6 run against staging and prod",
  id: "l-new",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date("2026-09-30T10:00:00.000Z"),
  recordingId: "a0000075-0000-4000-8000-000000000081",
  repro: null,
  retrievalCue: null,
  run: "ad-hoc",
  supersedes: "l-old",
  surface: "cli",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** The retired claim's latest stored recording. */
const stored = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
  ...replacement({ id: "l-old", supersedes: null }),
  createdAt: new Date("2026-09-29T10:00:00.000Z"),
  searchable: "",
  seq: 1,
  ...over,
});

describe("retiredClaimIds", () => {
  it("retires a claim a LATER recording names", () => {
    expect([...retiredClaimIds({ rows: [OLD, NEW_RETIRING_OLD] })]).toEqual(["l-old"]);
  });

  it("brings a claim back when it is recorded again after its retirement", () => {
    expect([...retiredClaimIds({ rows: [OLD, NEW_RETIRING_OLD, OLD] })]).toEqual([]);
  });

  it("retires a claim absent from the rows read, so a filtered read cannot bring it back", () => {
    expect([...retiredClaimIds({ rows: [rec({ id: "l-new", supersedes: "l-elsewhere" })] })]).toEqual(["l-elsewhere"]);
  });

  it("retires nothing when no recording names a claim", () => {
    expect([...retiredClaimIds({ rows: [OLD, rec({ id: "l-new" })] })]).toEqual([]);
  });
});

describe("withoutRetired", () => {
  it("drops every recording of a retired claim and keeps the rest in order", () => {
    const rows = [OLD, rec({ id: "l-other" }), OLD, NEW_RETIRING_OLD];
    expect(withoutRetired({ rows }).map((row) => row.id)).toEqual(["l-other", "l-new"]);
  });
});

describe("supersessionCheck", () => {
  it("accepts a target of the same kind", () => {
    expect(supersessionCheck({ row: replacement(), target: ok(stored()) }).isOk()).toBe(true);
  });

  it("refuses a target no recording carries, naming where to copy an id from", () => {
    const refused = supersessionCheck({
      row: replacement(),
      target: err(KnowledgeErrors.memoryUnknown({ memoryId: "l-old" })),
    });
    expect(unwrapErr(refused).message).toBe(
      "cannot supersede l-old — no recording carries that claim id — copy it from `slopweaver knowledge recall`",
    );
  });

  it("refuses a target of another kind, so a lesson never hides one of the owner's preferences", () => {
    const refused = supersessionCheck({ row: replacement(), target: ok(stored({ kind: "preference" })) });
    expect(unwrapErr(refused).message).toBe(
      "cannot supersede l-old — it is a preference, and a lesson retires only another lesson",
    );
  });

  it("passes a store failure through unchanged rather than calling it a missing claim", () => {
    const failure = KnowledgeErrors.databaseFailed({ cause: new Error("down"), doing: "read" });
    expect(unwrapErr(supersessionCheck({ row: replacement(), target: err(failure) })).code).toBe("DATABASE_FAILED");
  });
});
