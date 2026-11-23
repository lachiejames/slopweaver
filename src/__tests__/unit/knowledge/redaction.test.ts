/**
 * Knowledge redaction's pure core over SYNTHETIC rules — every forbidden token below is invented and hashed
 * here, and a provider location is assembled at runtime so this file never carries a literal one.
 */
import { describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import {
  type ForbiddenIdentifierRules,
  IDENTIFIER_KINDS,
  identifierDigest,
  identifierScanner,
} from "../../../hygiene/identifierScan.js";
import { parseReplacementMap, type ReplacementRule } from "../../../hygiene/replacementMap.js";
import { memoryId } from "../../../knowledge/memoryRow.js";
import {
  LOCATION_MASK,
  maskIdentifierSpans,
  planKnowledgeRedaction,
  redactText,
} from "../../../knowledge/redaction.js";
import { KnowledgeRedactionErrors } from "../../../knowledge/redactionErrors.js";
import { KNOWLEDGE_REFERENCE_FIELDS } from "../../../knowledge/redactionFields.js";
import { type RedactableMemory, type RedactableRecall, scanKnowledgeRows } from "../../../knowledge/redactionScan.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const d = ({ text }: { text: string }): string => identifierDigest({ text });

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [d({ text: "XK42PLM" })],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [{ hash: d({ text: "quuxcorp" }), length: 8 }],
    substringCs: [],
    teamKeys: [],
    wordCi: [d({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [
    {
      allowed: ["acme", "example"],
      marker: "slack.com",
      provider: "slack",
      re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.slack\.com/gi,
    },
  ],
};

const scanner = identifierScanner({ rules: RULES });

/** A workspace location on the synthetic provider, built at runtime. */
const location = ({ label }: { label: string }): string => `${label}.slack.com`;

/** The parsed rules of one map text. */
const mapOf = ({ text }: { text: string }): readonly ReplacementRule[] =>
  unwrap(parseReplacementMap({ path: "map.tsv", text }));

const MAP = mapOf({ text: "literal,preserve-case\tquuxcorp\tacme" });

/** One recording whose id is derived from its own domain and claim, as the real writer does. */
const memory = ({
  recordingId,
  domain = "slack",
  claim,
  ...over
}: Partial<RedactableMemory> & { recordingId: string; claim: string }): RedactableMemory => ({
  behaviourChange: null,
  caveat: null,
  claim,
  domain,
  evidence: "measured",
  id: memoryId({ claim, domain, kind: "lesson" }),
  importKey: null,
  kind: "lesson",
  learner: null,
  question: null,
  recordingId,
  repro: null,
  retrievalCue: null,
  run: "run-1",
  supersedes: null,
  ...over,
});

describe("every committed provider-location rule allows the location mask", () => {
  it("so a masked label never matches its own rule again", () => {
    expect(FORBIDDEN_IDENTIFIER_RULES.providerLocations.length).toBeGreaterThan(0);
    expect(
      FORBIDDEN_IDENTIFIER_RULES.providerLocations.filter((rule) => !rule.allowed.includes(LOCATION_MASK)),
    ).toEqual([]);
  });
});

describe("maskIdentifierSpans", () => {
  it("masks right to left, merging spans that overlap or touch into one mask", () => {
    const spans = [
      { kind: "forbidden-word-ci" as const, length: 3, offset: 4 },
      { kind: "forbidden-word-ci" as const, length: 2, offset: 0 },
      { kind: "forbidden-substring-ci" as const, length: 2, offset: 6 },
    ];
    expect(maskIdentifierSpans({ spans, text: "ab  cdefgh" })).toBe("redacted  redactedgh");
  });

  it("a merged run of location labels alone takes the location mask", () => {
    expect(
      maskIdentifierSpans({ spans: [{ kind: "forbidden-provider-location", length: 3, offset: 0 }], text: "abc.x" }),
    ).toBe("example.x");
  });
});

describe("redactText", () => {
  it("the map rewrites first, in the casing it found", () => {
    expect(redactText({ map: MAP, scanner, text: "the Quuxcorp board" })).toBe("the Acme board");
    expect(redactText({ map: MAP, scanner, text: "the QuuxCorp board" })).toBe("the acme board");
  });

  it("with no map, the committed rules mask what they find, and a location keeps its host", () => {
    const text = `zorblatt said XK42PLM on ${location({ label: "wobble" })}`;
    expect(redactText({ map: [], scanner, text })).toBe(`redacted said redacted on ${location({ label: "example" })}`);
  });

  it("a row about the provider in general passes untouched", () => {
    const text = `${location({ label: "acme" })} paging is by cursor`;
    expect(redactText({ map: [], scanner, text })).toBe(text);
  });

  it("a map rule that produces a forbidden name is still masked after it", () => {
    expect(redactText({ map: mapOf({ text: "literal\tfoo\tzorblatt" }), scanner, text: "foo" })).toBe("redacted");
  });
});

describe("scanKnowledgeRows", () => {
  it("counts distinct rows by kind and by field, and never a value", () => {
    const memories = [
      memory({ claim: "zorblatt and quuxcorp", evidence: "XK42PLM", recordingId: "r1" }),
      memory({ claim: "clean", recordingId: "r2" }),
    ];
    const recalls: RedactableRecall[] = [{ evidence: "zorblatt", memoryId: "m", recallId: "c1", run: "x" }];
    const scan = scanKnowledgeRows({ memories, recalls, scanner });
    expect(scan.rowsWithReferences).toBe(2);
    expect([scan.memoriesScanned, scan.recallsScanned]).toEqual([2, 1]);
    expect(scan.byKind["forbidden-word-ci"]).toBe(2);
    expect(scan.byKind["forbidden-substring-ci"]).toBe(1);
    expect(scan.byKind["forbidden-exact-id"]).toBe(1);
    expect(scan.byField["memories.claim"]).toBe(1);
    expect(scan.byField["memories.evidence"]).toBe(1);
    expect(scan.byField["memory_recalls.evidence"]).toBe(1);
    expect(scan.byField["memories.domain"]).toBe(0);
  });

  it("an empty batch reads zero everywhere", () => {
    const scan = scanKnowledgeRows({ memories: [], recalls: [], scanner });
    expect(scan.rowsWithReferences).toBe(0);
    expect(Object.values(scan.byField).every((count) => count === 0)).toBe(true);
  });

  it("lists every scanned field and every kind, so a report never drops a column", () => {
    const scan = scanKnowledgeRows({ memories: [], recalls: [], scanner });
    expect(KNOWLEDGE_REFERENCE_FIELDS.length).toBeGreaterThan(0);
    expect(Object.keys(scan.byField).toSorted()).toEqual(KNOWLEDGE_REFERENCE_FIELDS.toSorted());
    expect(Object.keys(scan.byKind).toSorted()).toEqual([...IDENTIFIER_KINDS].toSorted());
  });
});

describe("planKnowledgeRedaction", () => {
  it("moves a claim whose text changed, carrying the new id into supersedes and recalls, keeping physical identity", () => {
    const first = memory({ claim: "quuxcorp pages by cursor", recordingId: "r1" });
    const second = memory({ claim: "quuxcorp pages by cursor", evidence: "again", recordingId: "r2" });
    const other = memory({ claim: "a later claim", recordingId: "r3", supersedes: first.id });
    const recalls: RedactableRecall[] = [{ evidence: "used it", memoryId: first.id, recallId: "c1", run: "run-2" }];
    const plan = unwrap(planKnowledgeRedaction({ map: MAP, memories: [first, second, other], recalls, scanner }));
    const moved = memoryId({ claim: "acme pages by cursor", domain: "slack", kind: "lesson" });
    expect(plan.idMap).toEqual([{ from: first.id, to: moved }]);
    expect(plan.memories.map((row) => [row.recordingId, row.id, row.claim])).toEqual([
      ["r1", moved, "acme pages by cursor"],
      ["r2", moved, "acme pages by cursor"],
      ["r3", other.id, "a later claim"],
    ]);
    expect(plan.memories[2]!.supersedes).toBe(moved);
    expect(plan.recalls[0]!.memoryId).toBe(moved);
    expect([plan.changedMemories, plan.changedRecalls, plan.merges]).toEqual([3, 1, 0]);
  });

  it("a clean batch plans no change", () => {
    const row = memory({ claim: "clean", recordingId: "r1" });
    const plan = unwrap(planKnowledgeRedaction({ map: MAP, memories: [row], recalls: [], scanner }));
    expect([plan.changedMemories, plan.idMap.length]).toEqual([0, 0]);
    expect(plan.memories[0]).toBe(row);
  });

  it("two claims landing on one id count a merge, and a self-supersession it creates is dropped", () => {
    const kept = memory({ claim: "acme pages by cursor", recordingId: "r1" });
    const folded = memory({ claim: "quuxcorp pages by cursor", recordingId: "r2", supersedes: kept.id });
    const plan = unwrap(planKnowledgeRedaction({ map: MAP, memories: [kept, folded], recalls: [], scanner }));
    expect(plan.merges).toBe(1);
    expect(plan.memories.map((row) => [row.id, row.supersedes])).toEqual([
      [kept.id, null],
      [kept.id, null],
    ]);
  });

  it("refuses an import key carrying a forbidden identifier, naming the field and a count, never the row", () => {
    const row = memory({ claim: "clean", importKey: "zorblatt-key", recordingId: "r1" });
    const error = unwrapErr(planKnowledgeRedaction({ map: MAP, memories: [row], recalls: [], scanner }));
    expect(error).toEqual(KnowledgeRedactionErrors.identityHit({ field: "memories.import_key", rows: 1 }));
    expect(error.message).toBe(
      "knowledge redaction: 1 row(s) carry a forbidden identifier in memories.import_key, an identity column this " +
        "redaction does not rewrite — nothing was written",
    );
  });

  it("refuses a recall naming a claim outside the batch whose id carries a hit", () => {
    const recalls: RedactableRecall[] = [{ evidence: "e", memoryId: "zorblatt-1", recallId: "c1", run: "r" }];
    const error = unwrapErr(planKnowledgeRedaction({ map: MAP, memories: [], recalls, scanner }));
    expect(error).toEqual(KnowledgeRedactionErrors.identityHit({ field: "memory_recalls.memory_id", rows: 1 }));
  });
});
