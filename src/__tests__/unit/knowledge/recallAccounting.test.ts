/**
 * Recall accounting's pure half: when a recall moves the verdict, and what the regrading recording carries.
 *
 * The identity case is the one that matters most. A regrade that altered one character of the claim would
 * mint a DIFFERENT claim id and leave the old belief standing as the one recall returns — the exact failure
 * `skills/knowledge/reference/detective-lessons.md` asks a human to avoid by hand.
 */
import { describe, expect, it } from "vitest";

import type { MemoryRecording } from "../../../knowledge/memory.js";
import {
  parseRecallFields,
  RECALL_EVIDENCE_MAX,
  type RecallFields,
  recordingOf,
  regradeFor,
  regradeRecording,
} from "../../../knowledge/recallAccounting.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

const RECORDING_ID = "a0000075-0000-4000-8000-000000000081";
const REGRADE_ID = "99999999-2222-3333-4444-555555555555";
const RECORDED_AT = new Date("2026-09-16T10:00:00.000Z");

/** The claim's current recording, as the store hands it over. */
const latest = (over: Partial<MemoryRecording> = {}): MemoryRecording => ({
  behaviourChange: "check the agent sample rate first",
  caveat: "measured on one service",
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-abc123",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date("2026-09-12T10:00:00.000Z"),
  recordingId: RECORDING_ID,
  repro: "slopweaver datadog probe --from 7d",
  retrievalCue: "a datadog tracing task",
  run: "ad-hoc",
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** A complete, valid recall. */
const fields = (over: Partial<RecallFields> = {}): RecallFields => ({
  evidence: "re-ran the probe on 16 Sep and the filter still kept 0 of 388",
  memoryId: "l-abc123",
  outcome: "held",
  run: "ad-hoc",
  ...over,
});

describe("regradeFor", () => {
  it("records the caller's verdict when the memory broke", () => {
    expect(regradeFor({ currentVerdict: "confirmed", outcome: "broke", verdict: "changed" })).toEqual({
      kind: "record",
      verdict: "changed",
    });
  });

  it("records a confirmation when a claim the register had refuted held again", () => {
    expect(regradeFor({ currentVerdict: "refuted", outcome: "held", verdict: undefined })).toEqual({
      kind: "record",
      verdict: "confirmed",
    });
  });

  it("writes nothing when a confirmed claim held, so the repeat count stays a count of LEARNING", () => {
    expect(regradeFor({ currentVerdict: "confirmed", outcome: "held", verdict: undefined })).toEqual({ kind: "none" });
  });

  it("writes nothing for a recall nobody checked, whatever the register believes", () => {
    expect(regradeFor({ currentVerdict: "refuted", outcome: "unchecked", verdict: undefined })).toEqual({
      kind: "none",
    });
  });
});

describe("parseRecallFields", () => {
  it("keeps every field, trimmed", () => {
    const parsed = unwrap(parseRecallFields({ fields: fields({ evidence: "  checked it  " }) }));
    expect(parsed.evidence).toBe("checked it");
  });

  it("refuses a broke with no verdict, because refuted and changed say different things", () => {
    expect(unwrapErr(parseRecallFields({ fields: fields({ outcome: "broke" }) })).message).toContain("verdict");
  });

  it("refuses a verdict on an outcome that did not break", () => {
    expect(unwrapErr(parseRecallFields({ fields: fields({ verdict: "refuted" }) })).message).toContain(
      "only a memory that BROKE",
    );
  });

  it("accepts a broke that names its verdict", () => {
    const parsed = unwrap(parseRecallFields({ fields: fields({ outcome: "broke", verdict: "refuted" }) }));
    expect(parsed.verdict).toBe("refuted");
  });

  it("refuses an outcome outside the vocabulary", () => {
    const parsed = parseRecallFields({ fields: { ...fields(), outcome: "maybe" } as unknown as RecallFields });
    expect(unwrapErr(parsed).message).toContain("outcome");
  });

  it("refuses evidence past its cap", () => {
    const parsed = parseRecallFields({ fields: fields({ evidence: "e".repeat(RECALL_EVIDENCE_MAX + 1) }) });
    expect(unwrapErr(parsed).message).toContain("evidence");
  });

  it("refuses an empty claim id rather than accounting against nothing", () => {
    expect(unwrapErr(parseRecallFields({ fields: fields({ memoryId: "   " }) })).message).toContain("memory-id");
  });
});

describe("recordingOf", () => {
  /** A row exactly as the database hands it back, with the widths Postgres actually uses. */
  const row = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
    behaviourChange: "check the agent sample rate first",
    caveat: null,
    claim: "APM adaptive sampling sits upstream of retention filters",
    createdAt: new Date("2026-09-12T11:00:00.000Z"),
    domain: "datadog",
    evidence: "0 of 412 traces over 7d",
    id: "l-abc123",
    importKey: null,
    kind: "lesson",
    learner: "fleet",
    outcome: null,
    question: null,
    recordedAt: new Date("2026-09-12T10:00:00.000Z"),
    recordingId: RECORDING_ID,
    repro: null,
    retrievalCue: "a datadog tracing task",
    run: "ad-hoc",
    searchable: "",
    seq: 3,
    supersedes: null,
    surface: "api",
    tier: 2,
    verdict: "confirmed",
    ...over,
  });

  it("narrows the smallint tier to the four-value ladder", () => {
    expect(recordingOf({ row: row() }).tier).toBe(2);
  });

  it("reads a tier outside the ladder as NULL rather than asserting a judgement nobody made", () => {
    expect(recordingOf({ row: row({ tier: 9 }) }).tier).toBe(null);
  });

  it("reads a surface outside the vocabulary as NULL for the same reason", () => {
    expect(recordingOf({ row: row({ surface: null }) }).surface).toBe(null);
  });

  it("carries every other column across unchanged, the search column aside", () => {
    const narrowed = recordingOf({ row: row({ caveat: "one service only", question: null }) });
    expect([narrowed.id, narrowed.claim, narrowed.caveat, narrowed.run, narrowed.recordingId]).toEqual([
      "l-abc123",
      "APM adaptive sampling sits upstream of retention filters",
      "one service only",
      "ad-hoc",
      RECORDING_ID,
    ]);
  });

  it("carries a stored supersedes across the read, so a retirement survives the store round trip", () => {
    expect(recordingOf({ row: row({ supersedes: "l-0000000000000000" }) }).supersedes).toBe("l-0000000000000000");
  });
});

describe("regradeRecording", () => {
  it("carries the claim, the domain and every facet across so the claim id cannot drift", () => {
    const regraded = regradeRecording({
      evidence: "the filter now keeps 388 of 388 — the endpoint moved",
      latest: latest(),
      recordedAt: RECORDED_AT,
      recordingId: REGRADE_ID,
      run: "some-run",
      verdict: "changed",
    });
    expect(regraded).toEqual({
      behaviourChange: "check the agent sample rate first",
      caveat: "measured on one service",
      claim: "APM adaptive sampling sits upstream of retention filters",
      domain: "datadog",
      evidence: "the filter now keeps 388 of 388 — the endpoint moved",
      id: "l-abc123",
      importKey: null,
      kind: "lesson",
      learner: "fleet",
      outcome: null,
      question: null,
      recordedAt: RECORDED_AT,
      recordingId: REGRADE_ID,
      repro: "slopweaver datadog probe --from 7d",
      retrievalCue: "a datadog tracing task",
      run: "some-run",
      supersedes: null,
      surface: "api",
      tier: 2,
      verdict: "changed",
    });
  });

  it("names no claim to retire, so a regrade never repeats a retirement the original already made", () => {
    const regraded = regradeRecording({
      evidence: "the filter now keeps 388 of 388 — the endpoint moved",
      latest: latest({ supersedes: "l-0000000000000000" }),
      recordedAt: RECORDED_AT,
      recordingId: REGRADE_ID,
      run: "some-run",
      verdict: "changed",
    });
    expect(regraded.supersedes).toBe(null);
  });
  it("carries a trace's own facets too, so a regraded trace stays a trace", () => {
    const regraded = regradeRecording({
      evidence: "the probe returns 4 rows now",
      latest: latest({
        id: "t-abc",
        kind: "trace",
        outcome: "empty",
        question: "why did the staging pool exhaust",
        surface: null,
        tier: null,
      }),
      recordedAt: RECORDED_AT,
      recordingId: REGRADE_ID,
      run: "ad-hoc",
      verdict: "refuted",
    });
    expect([regraded.kind, regraded.outcome, regraded.question, regraded.verdict]).toEqual([
      "trace",
      "empty",
      "why did the staging pool exhaust",
      "refuted",
    ]);
  });
});
