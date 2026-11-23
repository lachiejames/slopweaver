/**
 * The counting half of knowledge redaction — which register rows still carry a forbidden identifier, by kind and
 * by column. Pure: no I/O, no clock. `./redaction.ts` plans the rewrite and proves its result through this scan;
 * `./redactionStore.ts` runs it over the stored rows.
 *
 * Nothing here returns or renders matched text, an excerpt or a row id: a scan is counts by kind and by field.
 */
import type { IdentifierKind, IdentifierScanner } from "../hygiene/identifierScan.js";

import type { MemoryKind } from "./memory.js";
import type { KnowledgeReferenceField } from "./redactionFields.js";

/** The columns of one recording the redactor reads — what both an insert row and a stored row carry. */
export interface RedactableMemory {
  readonly recordingId: string;
  readonly id: string;
  readonly kind: MemoryKind;
  readonly domain: string;
  readonly claim: string;
  readonly evidence: string;
  readonly repro: string | null;
  readonly question: string | null;
  readonly caveat: string | null;
  readonly learner: string | null;
  readonly behaviourChange: string | null;
  readonly retrievalCue: string | null;
  readonly run: string;
  readonly importKey: string | null;
  readonly supersedes: string | null;
}

/** The columns of one recall the redactor reads. */
export interface RedactableRecall {
  readonly recallId: string;
  readonly memoryId: string;
  readonly evidence: string;
  readonly run: string;
}

/** What a scan found, as counts only — never a value, an excerpt or a row id. */
export interface KnowledgeReferenceScan {
  readonly memoriesScanned: number;
  readonly recallsScanned: number;
  /** Distinct rows, recordings and recalls together, carrying at least one forbidden identifier anywhere. */
  readonly rowsWithReferences: number;
  /** Per kind, the distinct rows carrying that kind in any column. */
  readonly byKind: Readonly<Record<IdentifierKind, number>>;
  /** Per column, the distinct rows carrying any kind in it. */
  readonly byField: Readonly<Record<KnowledgeReferenceField, number>>;
}

/** Every column of a recording, as a report field and the value it holds. */
function memoryColumns({ row }: { row: RedactableMemory }): readonly [KnowledgeReferenceField, string | null][] {
  return [
    ["memories.id", row.id],
    ["memories.domain", row.domain],
    ["memories.claim", row.claim],
    ["memories.evidence", row.evidence],
    ["memories.repro", row.repro],
    ["memories.question", row.question],
    ["memories.caveat", row.caveat],
    ["memories.learner", row.learner],
    ["memories.behaviour_change", row.behaviourChange],
    ["memories.retrieval_cue", row.retrievalCue],
    ["memories.run", row.run],
    ["memories.import_key", row.importKey],
    ["memories.supersedes", row.supersedes],
  ];
}

/** Every column of a recall, as a report field and the value it holds. */
function recallColumns({ row }: { row: RedactableRecall }): readonly [KnowledgeReferenceField, string][] {
  return [
    ["memory_recalls.memory_id", row.memoryId],
    ["memory_recalls.evidence", row.evidence],
    ["memory_recalls.run", row.run],
  ];
}

/** Zero for every kind, spelled out so a kind added to the scanner fails to compile here rather than go uncounted. */
function zeroKinds(): Record<IdentifierKind, number> {
  return {
    "forbidden-embedded-upper": 0,
    "forbidden-exact-id": 0,
    "forbidden-provider-location": 0,
    "forbidden-substring-ci": 0,
    "forbidden-substring-cs": 0,
    "forbidden-team-key": 0,
    "forbidden-word-ci": 0,
    "forbidden-word-cs": 0,
  };
}

/** Zero for every scanned column, spelled out for the same reason as {@link zeroKinds}. */
function zeroFields(): Record<KnowledgeReferenceField, number> {
  return {
    "memories.behaviour_change": 0,
    "memories.caveat": 0,
    "memories.claim": 0,
    "memories.domain": 0,
    "memories.evidence": 0,
    "memories.id": 0,
    "memories.import_key": 0,
    "memories.learner": 0,
    "memories.question": 0,
    "memories.repro": 0,
    "memories.retrieval_cue": 0,
    "memories.run": 0,
    "memories.supersedes": 0,
    "memory_recalls.evidence": 0,
    "memory_recalls.memory_id": 0,
    "memory_recalls.run": 0,
  };
}

/**
 * Pure: count, by kind and by column, the rows still carrying a forbidden identifier.
 *
 * @param memories the recordings to scan
 * @param recalls the recalls to scan
 * @param scanner a scanner bound to the committed rules
 * @returns the counts — every kind and every field present, zero when clean
 */
export function scanKnowledgeRows({
  memories,
  recalls,
  scanner,
}: {
  memories: readonly RedactableMemory[];
  recalls: readonly RedactableRecall[];
  scanner: IdentifierScanner;
}): KnowledgeReferenceScan {
  const byKind = zeroKinds();
  const byField = zeroFields();
  let rowsWithReferences = 0;
  const countRow = ({ columns }: { columns: readonly (readonly [KnowledgeReferenceField, string | null])[] }): void => {
    const kinds = new Set<IdentifierKind>();
    for (const [field, value] of columns) {
      const spans = value === null ? [] : scanner.spans({ content: value });
      if (spans.length > 0) {
        byField[field] += 1;
      }
      spans.forEach((span) => kinds.add(span.kind));
    }
    kinds.forEach((kind) => {
      byKind[kind] += 1;
    });
    rowsWithReferences += kinds.size > 0 ? 1 : 0;
  };
  memories.forEach((row) => {
    countRow({ columns: memoryColumns({ row }) });
  });
  recalls.forEach((row) => {
    countRow({ columns: recallColumns({ row }) });
  });
  return { byField, byKind, memoriesScanned: memories.length, recallsScanned: recalls.length, rowsWithReferences };
}
