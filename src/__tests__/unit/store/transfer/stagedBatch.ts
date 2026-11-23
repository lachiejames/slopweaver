/**
 * A batch staged exactly as `store import --stage` stages one, its rows read back as the store returns them: the
 * fixture export written to a throwaway directory, read, planned against a live store and drafted, then every payload
 * passed through JSON as jsonb returns it. Synthetic organisation throughout.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unwrap } from "#lib/result.js";

import { type StoreExportContents, writeStoreExport } from "../../../../store/transfer/bundlePublish.js";
import { contentDigest, readExportBundle } from "../../../../store/transfer/bundleRead.js";
import { type ImportPlan, planImport, STORE_IMPORT_COMPARISON_VERSION } from "../../../../store/transfer/compare.js";
import type {
  reconstructStagedImport,
  StagedImport,
  StagedResolutionRow,
} from "../../../../store/transfer/importApplyPlan.js";
import { liveRetained } from "../../../../store/transfer/liveRetained.js";
import type { StoreExportPartKind } from "../../../../store/transfer/parts.js";
import type { RetainedEntry } from "../../../../store/transfer/retained.js";
import { type ImportStageDraft, importStageDraft } from "../../../../store/transfer/staged.js";
import type { StagedItemRow } from "../../../../store/transfer/stagedDecode.js";
import { CONTENTS, MEMORY_LINE, STANDING_ASK_LINES } from "./fixtures.js";

/** The staged batch's id. */
export const BATCH_ID = "00000000-0000-4000-8000-0000000000d4";

/** A live store holding nothing in any part. */
export const EMPTY_LIVE: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]> = new Map([
  ["memories", []],
  ["memory-recalls", []],
  ["owner-profile", []],
  ["owner-voice", []],
  ["owner-directives", []],
  ["standing-asks", []],
  ["steer-verdicts", []],
]);

/** The fixture export with its standing ask left active, so every part holds a row. */
export const ACTIVE: StoreExportContents = { ...CONTENTS, standingAskLines: [STANDING_ASK_LINES[0]] };

/** The fixture's memory, as the record its line holds. */
const MEMORY: Record<string, unknown> = JSON.parse(MEMORY_LINE);

/** The fixture's memory, its claim changed. */
export const CHANGED_MEMORY_LINE = JSON.stringify({ ...MEMORY, claim: "acme's widget queue drains out of order" });

/** A staged batch's rows, as the store would return them, and the draft they were staged from. */
export interface StagedBatch {
  readonly draft: ImportStageDraft;
  readonly rows: Parameters<typeof reconstructStagedImport>[0];
}

/**
 * The live store holding an export of these contents.
 *
 * @returns each part's live entries
 */
export function liveOf({
  contents,
}: {
  contents: StoreExportContents;
}): ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]> {
  return unwrap(liveRetained({ contents }));
}

/**
 * Every queued cleanup run and the queue emptied, each one attempted whatever an earlier one threw.
 *
 * @param cleanups the queue {@link stagedBatch} pushes each export directory's removal onto
 */
export function runCleanups({ cleanups }: { cleanups: (() => void)[] }): void {
  const failures: unknown[] = [];
  for (const clean of cleanups.splice(0)) {
    try {
      clean();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} staged-batch cleanup(s) failed`);
  }
}

/**
 * An export of `contents`, planned against `live` and staged, its rows read back through JSON as jsonb returns them.
 *
 * @param cleanups where the throwaway export directory's removal is pushed, for the caller's `afterEach`
 * @param resolutions the answers the batch holds, none by default
 * @returns the draft and the rows a store would return for it
 */
export function stagedBatch({
  cleanups,
  contents = ACTIVE,
  live = EMPTY_LIVE,
  resolutions = [],
}: {
  cleanups: (() => void)[];
  contents?: StoreExportContents;
  live?: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  resolutions?: readonly StagedResolutionRow[];
}): StagedBatch {
  const root = mkdtempSync(join(tmpdir(), "sw-apply-plan-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  const out = join(root, "export");
  unwrap(writeStoreExport({ contents, createdAtIso: "2026-10-31T00:00:00.000Z", out, producerVersion: "0.2.0" }));
  const reading = unwrap(readExportBundle({ dir: out, unmanifested: false }));
  const plan = unwrap(
    planImport({ contentDigest: contentDigest({ parts: reading.parts }), imported: reading.retained, live }),
  );
  const draft = unwrap(importStageDraft({ plan, reading }));
  const items: StagedItemRow[] = draft.items.map((item) => ({
    ...item,
    payload: JSON.parse(JSON.stringify(item.payload)),
  }));
  const batch = {
    comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
    contentDigest: draft.contentDigest,
    id: BATCH_ID,
    planDigest: draft.planDigest,
  };
  return { draft, rows: { batch, items, parts: draft.parts, questions: draft.questions, resolutions } };
}

/**
 * The staged import's export planned again against `live`.
 *
 * @param import the staged import read back
 * @returns the fresh plan
 */
export function replan({
  import: read,
  live,
}: {
  import: StagedImport;
  live: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
}): ImportPlan {
  return unwrap(planImport({ contentDigest: read.batch.contentDigest, imported: read.imported, live }));
}

/**
 * Every question's id in the draft.
 *
 * @returns the ids, in the draft's order
 */
export function questionIds({ draft }: { draft: ImportStageDraft }): readonly string[] {
  return draft.questions.map((question) => question.id);
}
