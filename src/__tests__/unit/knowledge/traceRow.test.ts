/**
 * The trace projection: what a stored recording becomes for every reader outside the store, and what it
 * refuses rather than guessing.
 *
 * The refusals are the point. A trace whose question or probe is null is a row the CHECK constraint makes
 * impossible, so meeting one means something is wrong — and defaulting it would put an invented probe in
 * front of the owner on the briefing page.
 */
import { describe, expect, it } from "vitest";

import { traceRowOf } from "../../../knowledge/traceRow.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

/** One stored trace, as the database returns it. */
const recording = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
  behaviourChange: "still run this leg",
  caveat: "Linear only; the load-test thread may name it another way",
  claim: "slopweaver store probe k6 --source linear — for: why did the staging pool exhaust",
  createdAt: new Date("2026-09-16T03:00:00.000Z"),
  domain: "store-detective",
  evidence: "exact 0, wild-both 0",
  id: "t-0000000000000001",
  importKey: null,
  kind: "trace",
  learner: "fleet",
  outcome: "empty",
  question: "why did the staging pool exhaust",
  recordedAt: new Date("2026-09-16T03:00:00.000Z"),
  recordingId: "a0000075-0000-4000-8000-000000000081",
  repro: "slopweaver store probe k6 --source linear",
  retrievalCue: "why did the staging pool exhaust",
  run: "ad-hoc",
  searchable: "",
  seq: 4,
  supersedes: null,
  surface: null,
  tier: null,
  verdict: "confirmed",
  ...over,
});

describe("traceRowOf", () => {
  it("projects the probe out of repro and the rest straight across", () => {
    const row = unwrap(traceRowOf({ recording: recording() }));
    expect(row).toEqual({
      doesNotProve: "Linear only; the load-test thread may name it another way",
      domain: "store-detective",
      evidence: "exact 0, wild-both 0",
      id: "t-0000000000000001",
      learner: "fleet",
      outcome: "empty",
      probe: "slopweaver store probe k6 --source linear",
      question: "why did the staging pool exhaust",
      recordedAtIso: "2026-09-16T03:00:00.000Z",
      run: "ad-hoc",
      verdict: "confirmed",
    });
  });

  it("drops the does-not-prove field entirely when the row carries no caveat", () => {
    const row = unwrap(traceRowOf({ recording: recording({ caveat: null, outcome: "paid" }) }));
    expect(Object.hasOwn(row, "doesNotProve")).toBe(false);
  });

  it("keeps the owner's attribution, which is the one learner value that was ever explicit", () => {
    expect(unwrap(traceRowOf({ recording: recording({ learner: "owner" }) })).learner).toBe("owner");
  });

  it("reads a null learner as the fleet, which is what an imported row always meant", () => {
    expect(unwrap(traceRowOf({ recording: recording({ learner: null }) })).learner).toBe("fleet");
  });

  it("REFUSES a lesson handed to it, naming the recording rather than coercing a kind", () => {
    const refused = traceRowOf({ recording: recording({ kind: "lesson" }) });
    expect(unwrapErr(refused).code).toBe("CORRUPT_RECORDING");
  });

  it("REFUSES a trace whose question is null rather than inventing one", () => {
    expect(unwrapErr(traceRowOf({ recording: recording({ question: null }) })).code).toBe("CORRUPT_RECORDING");
  });

  it("REFUSES a trace whose probe is null, since the probe is what settles it again", () => {
    expect(unwrapErr(traceRowOf({ recording: recording({ repro: null }) })).code).toBe("CORRUPT_RECORDING");
  });

  it("REFUSES a trace whose outcome is outside the vocabulary", () => {
    expect(unwrapErr(traceRowOf({ recording: recording({ outcome: null }) })).code).toBe("CORRUPT_RECORDING");
  });
});
