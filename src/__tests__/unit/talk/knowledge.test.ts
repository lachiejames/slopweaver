/**
 * The knowledge register as the console voice reads it: the fields a spoken answer needs, each cut, inside a
 * byte cap that drops whole claims and counts them.
 */
import { describe, expect, it } from "vitest";

import type { RecallHit } from "../../../knowledge/recall.js";
import { unwrap } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";
import { KNOWLEDGE_FIELD_MAX_CHARS, type KnowledgeAnswer, knowledgeForVoice } from "../../../talk/knowledge.js";
import { parseRecallPointer } from "../../../talk/recallPointer.js";

const row = (over: Partial<MemoryRecordingRow> = {}): MemoryRecordingRow => ({
  behaviourChange: "check the agent sample rate first",
  caveat: null,
  claim: "APM adaptive sampling sits upstream of retention filters",
  createdAt: new Date("2026-09-12T10:00:00.000Z"),
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-abc123",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: new Date("2026-09-12T10:00:00.000Z"),
  recordingId: "a0000075-0000-4000-8000-000000000081",
  repro: null,
  retrievalCue: "a datadog tracing task",
  run: "ad-hoc",
  searchable: "",
  seq: 1,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

const hit = (over: Partial<MemoryRecordingRow> = {}): RecallHit => ({
  broke: 0,
  held: 0,
  rank: 0.075,
  recalls: 0,
  recordings: 1,
  row: row(over),
  runs: 1,
});

describe("knowledgeForVoice", () => {
  it("keeps the fields a spoken answer needs, and none of the search columns", () => {
    const answer = knowledgeForVoice({ hasMore: false, hits: [hit()], maxBytes: 14_000, query: "sampling" });
    expect(answer.claims).toEqual([
      {
        behaviourChange: "check the agent sample rate first",
        caveat: null,
        claim: "APM adaptive sampling sits upstream of retention filters",
        domain: "datadog",
        evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
        kind: "lesson",
        pointer: "knowledge:l-abc123",
        recordedAtIso: "2026-09-12T10:00:00.000Z",
        repro: null,
        verdict: "confirmed",
      },
    ]);
    expect(answer.omitted).toBe(0);
    expect(answer.note).toContain("recall_open with that claim's pointer reads it whole");
  });

  it("prints a pointer recall_open's parser opens, for an id that needs encoding", () => {
    const answer = knowledgeForVoice({
      hasMore: false,
      hits: [hit({ id: "claim/one" })],
      maxBytes: 14_000,
      query: "q",
    });
    const pointer = answer.claims[0]!.pointer;
    expect(pointer).toBe("knowledge:claim%2Fone");
    expect(unwrap(parseRecallPointer({ text: pointer }))).toEqual({ kind: "knowledge", memoryId: "claim/one" });
  });

  it("cuts a long field and marks the cut", () => {
    const answer = knowledgeForVoice({
      hasMore: false,
      hits: [hit({ evidence: "e".repeat(KNOWLEDGE_FIELD_MAX_CHARS + 10) })],
      maxBytes: 14_000,
      query: "q",
    });
    expect(answer.claims[0]!.evidence).toBe(`${"e".repeat(KNOWLEDGE_FIELD_MAX_CHARS)} …`);
  });

  it("drops whole claims past the byte cap and counts them", () => {
    const hits = [hit({ id: "a" }), hit({ id: "b" }), hit({ id: "c" })];
    const bytesOf = (answer: KnowledgeAnswer) => Buffer.byteLength(JSON.stringify(answer), "utf8");
    const twoClaims = bytesOf(
      knowledgeForVoice({ hasMore: true, hits: hits.slice(0, 2), maxBytes: 14_000, query: "q" }),
    );
    const roomForTwo = twoClaims + 1;
    const answer = knowledgeForVoice({ hasMore: true, hits, maxBytes: roomForTwo, query: "q" });
    expect(answer.claims.length).toBe(2);
    expect(answer.omitted).toBe(1);
    expect(answer.hasMore).toBe(true);
    expect(bytesOf(answer)).toBeLessThanOrEqual(roomForTwo);
  });

  it("counts the note and the query against the cap, so the answer never passes it", () => {
    const hits = [hit({ id: "a" }), hit({ id: "b" })];
    const whole = knowledgeForVoice({ hasMore: false, hits, maxBytes: 14_000, query: "q" });
    const claimsOnly = Buffer.byteLength(JSON.stringify(whole.claims), "utf8");
    const answer = knowledgeForVoice({ hasMore: false, hits, maxBytes: claimsOnly, query: "q" });
    expect(answer.omitted).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(claimsOnly);
  });

  it("says the register holds nothing rather than returning silence", () => {
    const answer = knowledgeForVoice({ hasMore: false, hits: [], maxBytes: 14_000, query: "jumpcloud" });
    expect(answer.claims).toEqual([]);
    expect(answer.note).toBe(
      'The knowledge register holds nothing matching "jumpcloud". Say that, then try code_find or glossary.',
    );
  });
});
