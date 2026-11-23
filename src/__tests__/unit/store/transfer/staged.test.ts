/**
 * What staging an import writes, decided before any write: the approval, the answer check, and the draft that
 * carries every row whole and joins every question to its row. Pure, bar one round trip through a throwaway
 * export.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type StoreExportContents, writeStoreExport } from "../../../../store/transfer/bundlePublish.js";
import { type BundleReading, contentDigest, readExportBundle } from "../../../../store/transfer/bundleRead.js";
import {
  type ImportPlan,
  type ImportQuestion,
  planImport,
  STORE_IMPORT_COMPARISON_VERSION,
} from "../../../../store/transfer/compare.js";
import type { StoreExportPartKind } from "../../../../store/transfer/parts.js";
import type { StagedEntry } from "../../../../store/transfer/retained.js";
import {
  approveImportPlan,
  type ImportStageDraft,
  importStageDraft,
  type StagedBatchContents,
  stagedBatchDifference,
  staleQuestionRefusal,
  validateImportAction,
} from "../../../../store/transfer/staged.js";

import { CONTENTS } from "./fixtures.js";

const cleanups: (() => void)[] = [];

/** Removals owed once the whole file has run: the shared export's directory. */
const fileCleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

afterAll(() => {
  fileCleanups.splice(0).forEach((clean) => {
    clean();
  });
});

const EMPTY_LIVE: ReadonlyMap<StoreExportPartKind, readonly StagedEntry[]> = new Map([
  ["memories", []],
  ["memory-recalls", []],
  ["owner-profile", []],
  ["owner-voice", []],
  ["owner-directives", []],
  ["standing-asks", []],
  ["steer-verdicts", []],
]);

/**
 * An export's contents, written and read back, planned against an empty store; the fixture's by default.
 *
 * @param owed where its directory's removal is queued: after this case, unless the caller owns it for longer
 */
function exportAgainstEmpty({
  contents = CONTENTS,
  owed = cleanups,
}: { contents?: StoreExportContents; owed?: (() => void)[] } = {}): {
  reading: BundleReading;
  plan: ImportPlan;
} {
  const root = mkdtempSync(join(tmpdir(), "sw-staged-"));
  owed.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  const out = join(root, "export");
  unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
  const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
  const plan = unwrap(
    planImport({
      contentDigest: contentDigest({ parts: reading.parts }),
      imported: reading.retained,
      live: EMPTY_LIVE,
    }),
  );
  return { plan, reading };
}

/**
 * The fixture's export, written, read and planned ONCE for every case that takes it as it is. Each round trip
 * through a throwaway export measured ~150ms a case; `importStageDraft`, `approveImportPlan` and
 * `stagedBatchDifference` only read their inputs, and every case that edits one spreads a copy, so sharing it
 * loses nothing. The one case that needs other contents still builds its own.
 */
let fixture: { readonly reading: BundleReading; readonly plan: ImportPlan };

beforeAll(() => {
  fixture = exportAgainstEmpty({ owed: fileCleanups });
});

const ACTIVATION: Pick<ImportQuestion, "id" | "kind"> = { id: "import-q-0000000000000001", kind: "activation" };
const CONFLICT: Pick<ImportQuestion, "id" | "kind"> = { id: "import-q-0000000000000002", kind: "conflict" };

describe("approveImportPlan", () => {
  it("takes the plan whose digest was approved", () => {
    const { plan } = fixture;
    expect(unwrap(approveImportPlan({ approved: plan.digest, plan })).digest).toBe(plan.digest);
  });

  it("refuses a digest the plan no longer carries, naming both", () => {
    const { plan } = fixture;
    const refused = unwrapErr(approveImportPlan({ approved: "sha256:stale", plan }));
    expect(refused.code).toBe("IMPORT_APPROVAL_MISMATCH");
    expect([refused.approved, refused.planned]).toEqual(["sha256:stale", plan.digest]);
  });
});

describe("validateImportAction", () => {
  it("takes each answer its question's kind takes", () => {
    expect(unwrap(validateImportAction({ action: "activate", question: ACTIVATION }))).toBe("activate");
    expect(unwrap(validateImportAction({ action: "leave-inactive", question: ACTIVATION }))).toBe("leave-inactive");
    expect(unwrap(validateImportAction({ action: "keep-current", question: CONFLICT }))).toBe("keep-current");
    expect(unwrap(validateImportAction({ action: "take-imported", question: CONFLICT }))).toBe("take-imported");
  });

  it("refuses an answer from the other kind's vocabulary, naming the answers it does take", () => {
    const refused = unwrapErr(validateImportAction({ action: "take-imported", question: ACTIVATION }));
    expect(refused.code).toBe("IMPORT_ACTION_INVALID");
    expect(refused.allowed).toEqual(["activate", "leave-inactive"]);
    expect(refused.message).toBe("import-q-0000000000000001 takes activate or leave-inactive, not take-imported");
  });
});

describe("staleQuestionRefusal", () => {
  it("lets a question staged under this build's comparison version be answered", () => {
    expect(
      staleQuestionRefusal({ questionId: "import-q-0000000000000001", stagedVersion: STORE_IMPORT_COMPARISON_VERSION }),
    ).toBeUndefined();
  });

  it("refuses a question from a batch that recorded no comparison version", () => {
    expect(staleQuestionRefusal({ questionId: "import-q-0000000000000001", stagedVersion: null })).toEqual({
      code: "IMPORT_QUESTION_STALE",
      message:
        "import-q-0000000000000001 was staged before batches recorded their comparison version, and this build " +
        `compares by version ${String(STORE_IMPORT_COMPARISON_VERSION)}; it is not a question this build would ask, ` +
        "so no answer was recorded — the export has to be staged again",
      questionId: "import-q-0000000000000001",
      stagedVersion: null,
    });
  });

  it("refuses a question from a batch staged under another comparison version, naming it", () => {
    const other = STORE_IMPORT_COMPARISON_VERSION + 1;
    const refused = staleQuestionRefusal({ questionId: "import-q-0000000000000002", stagedVersion: other })!;
    expect(refused.code).toBe("IMPORT_QUESTION_STALE");
    expect(refused.stagedVersion).toBe(other);
    expect(refused.message).toBe(
      `import-q-0000000000000002 was staged under comparison version ${String(other)}, and this build compares by ` +
        `version ${String(STORE_IMPORT_COMPARISON_VERSION)}; it is not a question this build would ask, so no answer ` +
        "was recorded — the export has to be staged again",
    );
  });
});

describe("importStageDraft", () => {
  it("stages every row the export carried, in registry then decoder order, each with its whole decoded row", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const expected = [...reading.retained.entries()].flatMap(([part, entries]) =>
      entries.map((entry, ordinal) => [part, entry.key, ordinal]),
    );
    expect(draft.items.map((item) => [item.part, item.key, item.ordinal])).toEqual(expected);
    const memory = draft.items.find((item) => item.part === "memories")!;
    expect(memory.payload).toEqual(reading.retained.get("memories")![0]!.payload);
    expect(JSON.stringify(memory.payload)).toContain("acme's widget queue drains in order");
  });

  it("carries the plan's digest, made under this build's comparison version, the export's content digest, and whether it had a manifest", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    expect([plan.comparisonVersion, draft.planDigest, draft.contentDigest, draft.manifested]).toEqual([
      STORE_IMPORT_COMPARISON_VERSION,
      plan.digest,
      contentDigest({ parts: reading.parts }),
      true,
    ]);
  });

  it("names every part the reading carried, in registry order, an empty one included", () => {
    const { plan, reading } = exportAgainstEmpty({ contents: { ...CONTENTS, recallLines: [] } });
    expect(reading.retained.get("memory-recalls")).toEqual([]);
    const draft = unwrap(importStageDraft({ plan, reading }));
    expect(draft.items.filter((item) => item.part === "memory-recalls")).toEqual([]);
    expect(draft.parts).toEqual([
      "memories",
      "memory-recalls",
      "owner-profile",
      "owner-voice",
      "owner-directives",
      "standing-asks",
      "steer-verdicts",
    ]);
  });

  it("joins every question the plan raised to a staged row, and drops none", () => {
    const { plan, reading } = fixture;
    expect(plan.questions.length).toBeGreaterThan(0);
    const draft = unwrap(importStageDraft({ plan, reading }));
    expect(draft.questions.map((question) => question.id)).toEqual(plan.questions.map((question) => question.id));
    const staged = new Set(draft.items.map((item) => `${item.part} ${item.key}`));
    expect(draft.questions.filter((question) => !staged.has(`${question.part} ${question.key}`))).toEqual([]);
  });
});

/**
 * What the store would hold had this draft been staged, read back without payloads, which the database compares:
 * rows and questions in reverse order, to show order does not matter.
 */
function stagedFrom({ draft }: { draft: ImportStageDraft }): StagedBatchContents {
  return {
    comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
    items: draft.items.map(({ payload: _payload, ...columns }) => columns).toReversed(),
    manifested: draft.manifested,
    parts: draft.parts.toReversed(),
    planDigest: draft.planDigest,
    questions: draft.questions.map((question) => ({ ...question })).toReversed(),
  };
}

describe("stagedBatchDifference", () => {
  it("finds none in a batch holding exactly what the draft stages, in any order", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    expect(stagedBatchDifference({ draft, staged: stagedFrom({ draft }) })).toBe(undefined);
  });

  it("names an empty batch that claims the export's digest", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    expect(draft.items.length).toBeGreaterThan(0);
    const staged = { ...stagedFrom({ draft }), items: [], questions: [] };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it holds 0 rows that are not the export's ${draft.items.length}`,
    );
  });

  it("names a forged row the export never carried", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const real = stagedFrom({ draft });
    const forged = { ...real.items[0]!, fingerprint: `sha256:${"0".repeat(64)}` };
    const staged = { ...real, items: [forged, ...real.items.slice(1)] };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it holds ${draft.items.length} rows that are not the export's ${draft.items.length}`,
    );
  });

  it("names a row moved to another ordinal, which is how the database's payload check pairs a row with its own", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const real = stagedFrom({ draft });
    const staged = { ...real, items: [{ ...real.items[0]!, ordinal: 9999 }, ...real.items.slice(1)] };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it holds ${draft.items.length} rows that are not the export's ${draft.items.length}`,
    );
  });

  it("names a row whose summary was forged", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const real = stagedFrom({ draft });
    const staged = { ...real, items: [{ ...real.items[0]!, summary: "forged" }, ...real.items.slice(1)] };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it holds ${draft.items.length} rows that are not the export's ${draft.items.length}`,
    );
  });

  it("names a question whose imported or live summary was forged", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const real = stagedFrom({ draft });
    const expected = `it holds ${draft.questions.length} questions that are not the plan's ${draft.questions.length}`;
    const imported = {
      ...real,
      questions: [{ ...real.questions[0]!, imported: "forged" }, ...real.questions.slice(1)],
    };
    const live = { ...real, questions: [{ ...real.questions[0]!, live: "forged" }, ...real.questions.slice(1)] };
    expect([
      stagedBatchDifference({ draft, staged: imported }),
      stagedBatchDifference({ draft, staged: live }),
    ]).toEqual([expected, expected]);
  });

  it("names a forged question the plan never raised", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const real = stagedFrom({ draft });
    const staged = {
      ...real,
      questions: [...real.questions, { ...real.questions[0]!, id: "import-q-00000000000000ff" }],
    };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it holds ${draft.questions.length + 1} questions that are not the plan's ${draft.questions.length}`,
    );
  });

  it("names a batch staged before batches recorded a comparison version, rather than reading it as current", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const staged = { ...stagedFrom({ draft }), comparisonVersion: null };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      "it was staged before batches recorded their comparison version",
    );
  });

  it("names a batch staged under another comparison version, whose questions this build would not ask", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const other = STORE_IMPORT_COMPARISON_VERSION + 1;
    const staged = { ...stagedFrom({ draft }), comparisonVersion: other };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it was staged under comparison version ${String(other)}, and this build compares by version ${String(STORE_IMPORT_COMPARISON_VERSION)}`,
    );
  });

  it("names a batch staged under another plan, whose questions answer a store that has since moved", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const staged = { ...stagedFrom({ draft }), planDigest: `sha256:${"1".repeat(64)}` };
    expect(stagedBatchDifference({ draft, staged })).toBe(`it was staged under plan sha256:${"1".repeat(64)}`);
  });

  it("names a batch staged from a reading with a different manifest", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const staged = { ...stagedFrom({ draft }), manifested: !draft.manifested };
    expect(stagedBatchDifference({ draft, staged })).toBe("it was staged from a reading with a different manifest");
  });

  it("names a batch that carries other parts, even when every row matches, since an empty part is still a part", () => {
    const { plan, reading } = fixture;
    const draft = unwrap(importStageDraft({ plan, reading }));
    const staged = { ...stagedFrom({ draft }), parts: draft.parts.filter((part) => part !== "memory-recalls") };
    expect(stagedBatchDifference({ draft, staged })).toBe(
      `it carries the parts ${staged.parts.toSorted().join(", ")}, not the export's ${draft.parts.toSorted().join(", ")}`,
    );
  });
});

describe("importStageDraft refusals", () => {
  it("refuses a question whose row the reading does not carry rather than stage it without one", () => {
    const { plan, reading } = fixture;
    const orphan: ImportQuestion = {
      actions: ["activate", "leave-inactive"],
      id: "import-q-00000000000000ff",
      imported: "an ask nobody exported",
      key: "ask-missing",
      kind: "activation",
      live: null,
      part: "standing-asks",
    };
    const refused = unwrapErr(importStageDraft({ plan: { ...plan, questions: [...plan.questions, orphan] }, reading }));
    expect(refused.code).toBe("IMPORT_STAGE_INCONSISTENT");
    expect(refused.message).toBe(
      "import-q-00000000000000ff asks about standing-asks ask-missing, which the export's reading does not carry; nothing was staged",
    );
  });

  it("refuses a plan made under another comparison version rather than stage its questions as this build's", () => {
    const { plan, reading } = fixture;
    const other = STORE_IMPORT_COMPARISON_VERSION + 1;
    const refused = unwrapErr(importStageDraft({ plan: { ...plan, comparisonVersion: other }, reading }));
    expect(refused).toEqual({
      code: "IMPORT_PLAN_STALE",
      message:
        `the plan was made under comparison version ${String(other)}, and this build compares by version ` +
        `${String(STORE_IMPORT_COMPARISON_VERSION)}; nothing was staged — plan the export again with this build and ` +
        "approve that digest",
      planVersion: other,
    });
  });
});
