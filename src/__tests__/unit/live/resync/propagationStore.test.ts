import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { joinBatch, type PropagationRecord, propagationIdOf } from "../../../../live/resync/propagationBatch.js";
import {
  readActiveBatch,
  readPropagationRecord,
  retireActiveBatch,
  writeActiveBatch,
  writePropagationRecord,
} from "../../../../live/resync/propagationStore.js";

const NOW = "2026-09-27T14:30:00.000Z";

const RECORD: PropagationRecord = {
  propagatedAtIso: NOW,
  propagationId: propagationIdOf({ recipeId: "resync-corpus-github", syncFinishedAtIso: NOW }),
  recipeId: "resync-corpus-github",
  schemaVersion: 1,
  source: "github",
  surfaces: [
    {
      observedAtIso: NOW,
      producer: "github landing",
      readingId: "2026-09-27T143000.000Z",
      status: "re-derived",
      surface: "pull-requests-review-state",
    },
  ],
  syncFinishedAtIso: NOW,
};

let dir = "";

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "propagation-")), "propagation");
});

afterEach(() => {
  rmSync(join(dir, ".."), { force: true, recursive: true });
});

describe("propagation records", () => {
  it("writes one record per sync and reads it back whole", () => {
    expect(unwrap(writePropagationRecord({ dir, record: RECORD }))).toBe(
      join(dir, "records", `${RECORD.propagationId}.json`),
    );
    expect(unwrap(readPropagationRecord({ dir, propagationId: RECORD.propagationId }))).toEqual(RECORD);
  });

  it("names the path of a record that is not there", () => {
    const missing = unwrapErr(readPropagationRecord({ dir, propagationId: "missing" }));
    expect(missing.code).toBe("FILE_UNREADABLE");
    expect(missing.message).toContain(join(dir, "records", "missing.json"));
  });
});

describe("the active batch", () => {
  it("reads as null — no pass open — before any sync joined", () => {
    expect(unwrap(readActiveBatch({ dir }))).toBe(null);
  });

  it("round-trips through batch.json", () => {
    const { batch } = joinBatch({ active: null, batchId: "abcdef01", nowIso: NOW, record: RECORD });
    unwrap(writeActiveBatch({ batch, dir }));
    expect(unwrap(readActiveBatch({ dir }))).toEqual(batch);
  });

  it("reads a corrupt batch as an ERROR, never as no pass open — that would seat a second pass", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "batch.json"), "{ not json", "utf8");
    const corrupt = unwrapErr(readActiveBatch({ dir }));
    expect(corrupt.code).toBe("FILE_INVALID");
    expect(corrupt.message).toContain("batch.json: not JSON");
  });

  it("retires a finished batch to batches/<batchId>.json, leaving no pass open", () => {
    const { batch } = joinBatch({ active: null, batchId: "abcdef01", nowIso: NOW, record: RECORD });
    unwrap(writeActiveBatch({ batch, dir }));
    const retired = unwrap(retireActiveBatch({ batch: { ...batch, doneThrough: 1 }, dir }));
    expect(retired).toBe(join(dir, "batches", "abcdef01.json"));
    expect(existsSync(retired)).toBe(true);
    expect(unwrap(readActiveBatch({ dir }))).toBe(null);
  });
});
