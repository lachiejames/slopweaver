/**
 * The trace kind's pure half: the derived claim, the derived placement fields, and the refusals that stop a
 * dead end becoming a blind spot.
 *
 * The identity case asserts that an EMPTY and a PAID recording of the same probe share one exact id, because
 * that is what makes a flip visible in recall rather than hidden behind a second, unrelated trace.
 */
import { describe, expect, it } from "vitest";

import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { buildMemoryRecording, memoryId } from "../../../knowledge/memoryRow.js";
import {
  TRACE_PROBE_MAX,
  TRACE_QUESTION_MAX,
  type TraceFields,
  traceBehaviourChange,
  traceClaim,
  traceInput,
} from "../../../knowledge/trace.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const RECORDING_ID = "a0000075-0000-4000-8000-000000000081";
const RECORDED_AT = new Date("2026-09-16T10:00:00.000Z");
const NONE = noInstallDomains({ home: "/tmp/sw-home" });

/** A complete, valid empty trace. */
const fields = (over: Partial<TraceFields> = {}): TraceFields => ({
  doesNotProve: "Linear only; the load-test thread may name it another way",
  domain: "store-detective",
  evidence: "exact 0, wild-both 0 over the whole store",
  learner: "fleet",
  outcome: "empty",
  probe: "slopweaver store probe k6 --source linear",
  question: "why did the staging pool exhaust",
  run: "ad-hoc",
  ...over,
});

describe("traceClaim", () => {
  it("is the probe and the question, and nothing that moves between two runs", () => {
    expect(traceClaim({ probe: "  slopweaver store probe k6 ", question: " why did it exhaust " })).toBe(
      "slopweaver store probe k6 — for: why did it exhaust",
    );
  });
});

describe("traceBehaviourChange", () => {
  it("tells the next agent to still run an empty leg, citing the ruling", () => {
    expect(traceBehaviourChange({ outcome: "empty" })).toBe(
      "still run this leg; read the trace to reorder the work and to check what the emptiness did not prove",
    );
  });

  it("tells the next agent to open a paid probe early", () => {
    expect(traceBehaviourChange({ outcome: "paid" })).toBe(
      "open this probe early on a question like this one — it paid last time",
    );
  });
});

describe("traceInput", () => {
  it("builds a trace recording with its facets in their columns and the lesson facets null", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: unwrap(traceInput({ fields: fields() })),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row).toEqual({
      behaviourChange: traceBehaviourChange({ outcome: "empty" }),
      caveat: "Linear only; the load-test thread may name it another way",
      claim: "slopweaver store probe k6 --source linear — for: why did the staging pool exhaust",
      domain: "store-detective",
      evidence: "exact 0, wild-both 0 over the whole store",
      id: memoryId({
        claim: "slopweaver store probe k6 --source linear — for: why did the staging pool exhaust",
        domain: "store-detective",
        kind: "trace",
      }),
      importKey: null,
      kind: "trace",
      learner: "fleet",
      outcome: "empty",
      question: "why did the staging pool exhaust",
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
      repro: "slopweaver store probe k6 --source linear",
      retrievalCue: "why did the staging pool exhaust",
      run: "ad-hoc",
      supersedes: null,
      surface: null,
      tier: null,
      verdict: "confirmed",
    });
  });

  it("refuses to retire anything, so a dead end the next investigation needs stays visible", () => {
    const built = buildMemoryRecording({
      installDomains: NONE,
      input: { ...unwrap(traceInput({ fields: fields() })), supersedes: "t-0123456789abcdef" },
      recordedAt: RECORDED_AT,
      recordingId: RECORDING_ID,
    });
    expect(unwrapErr(built).code).toBe("SUPERSEDES_REFUSED");
  });

  it("prefixes the id t-, so the id says which contract produced it", () => {
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: unwrap(traceInput({ fields: fields() })),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.id.slice(0, 2)).toBe("t-");
  });

  it("files an empty and a later paid run of the same probe under ONE claim id", () => {
    const empty = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: unwrap(traceInput({ fields: fields() })),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    const paid = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: unwrap(traceInput({ fields: fields({ evidence: "exact 4", outcome: "paid" }) })),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(paid.id).toBe(empty.id);
  });

  it("refuses an empty probe that says nothing about what the emptiness does not prove", () => {
    const { doesNotProve: _dropped, ...rest } = fields();
    const refused = traceInput({ fields: rest });
    expect(unwrapErr(refused).message).toContain("does-not-prove");
  });

  it("accepts a paid probe with nothing said about what it does not prove, and stores no caveat", () => {
    const { doesNotProve: _dropped, ...rest } = fields({ outcome: "paid" });
    const row = unwrap(
      buildMemoryRecording({
        installDomains: NONE,
        input: unwrap(traceInput({ fields: rest })),
        recordedAt: RECORDED_AT,
        recordingId: RECORDING_ID,
      }),
    );
    expect(row.caveat).toBe(null);
  });

  it("refuses a question past its cap, naming the question rather than the derived claim", () => {
    const refused = traceInput({ fields: fields({ question: "q".repeat(TRACE_QUESTION_MAX + 1) }) });
    expect(unwrapErr(refused).message).toContain("question");
  });

  it("refuses a probe past its cap", () => {
    const refused = traceInput({ fields: fields({ probe: "p".repeat(TRACE_PROBE_MAX + 1) }) });
    expect(unwrapErr(refused).message).toContain("probe");
  });

  it("refuses a learner outside the vocabulary", () => {
    const refused = traceInput({ fields: fields({ learner: "someone" }) });
    expect(unwrapErr(refused).message).toContain("learner");
  });
});
