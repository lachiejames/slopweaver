/**
 * Decoding a restore's two files against real fixture files in a throwaway directory — every refusal is
 * reached before a restore opens a connection, so none of it needs a database.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeRestoreFiles } from "../../../cli/commands/knowledge/restoreFiles.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway directory this test may write fixtures into. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-restore-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** One exported recording line, as `knowledge export` writes it. */
const MEMORY_LINE = JSON.stringify({
  behaviourChange: "check the sample rate first",
  caveat: null,
  claim: "acme's widget queue drains in order",
  createdAt: "2026-10-01T09:00:01.000Z",
  domain: "datadog",
  evidence: "0 of 412 traces over 7d",
  id: "l-0000000000000001",
  importKey: null,
  kind: "lesson",
  learner: "fleet",
  outcome: null,
  question: null,
  recordedAt: "2026-10-01T09:00:00.000Z",
  recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
  repro: null,
  retrievalCue: "a widget queue task",
  run: "ad-hoc",
  seq: 4,
  supersedes: null,
  surface: "api",
  tier: 2,
  verdict: "confirmed",
});

/** One exported recall line. */
const RECALL_LINE = JSON.stringify({
  createdAt: "2026-10-02T09:00:01.000Z",
  evidence: "re-ran the probe, still 0",
  memoryId: "l-0000000000000001",
  outcome: "held",
  recallId: "cccccccc-0000-4000-8000-000000000001",
  recordedAt: "2026-10-02T09:00:00.000Z",
  recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
  run: "ad-hoc",
  seq: 2,
});

/** Write an export, and optionally its ledger, returning the export's path. */
function exportPair({ memories, recalls }: { memories: readonly string[]; recalls?: readonly string[] }): string {
  const file = join(scratch(), "memories.jsonl");
  writeFileSync(file, `${memories.join("\n")}\n`);
  if (recalls !== undefined) {
    writeFileSync(`${file}.recalls.jsonl`, `${recalls.join("\n")}\n`);
  }
  return file;
}

describe("decodeRestoreFiles", () => {
  it("decodes both files, keeping every seq as exported", () => {
    const decoded = unwrap(
      decodeRestoreFiles({ file: exportPair({ memories: [MEMORY_LINE], recalls: [RECALL_LINE] }) }),
    );
    expect(decoded.ledgerPresent).toBe(true);
    expect(decoded.incoming.memories.map((row) => [row.recordingId, row.seq])).toEqual([
      ["bbbbbbbb-0000-4000-8000-000000000001", 4],
    ]);
    expect(decoded.incoming.recalls.map((row) => [row.recallId, row.seq])).toEqual([
      ["cccccccc-0000-4000-8000-000000000001", 2],
    ]);
  });

  it("reads an absent ledger as zero recalls and says so, rather than failing", () => {
    const file = exportPair({ memories: [MEMORY_LINE] });
    const decoded = unwrap(decodeRestoreFiles({ file }));
    expect([decoded.ledgerPresent, decoded.ledgerPath, decoded.incoming.recalls.length]).toEqual([
      false,
      `${file}.recalls.jsonl`,
      0,
    ]);
  });

  it("refuses an export that cannot be read, rather than restoring nothing", () => {
    const missing = join(scratch(), "absent.jsonl");
    const refusal = unwrapErr(decodeRestoreFiles({ file: missing }));
    expect(refusal).toMatchObject({ code: "STORE_UNREADABLE", path: missing });
  });

  it("refuses a malformed register line, naming the line", () => {
    const refusal = unwrapErr(decodeRestoreFiles({ file: exportPair({ memories: [MEMORY_LINE, "{not json"] }) }));
    expect(refusal).toMatchObject({ code: "CORRUPT_ROW", lineNumber: 2 });
  });

  it("refuses a malformed ledger line even though the register decoded", () => {
    const refusal = unwrapErr(
      decodeRestoreFiles({ file: exportPair({ memories: [MEMORY_LINE], recalls: [RECALL_LINE, "[]"] }) }),
    );
    expect(refusal).toMatchObject({ code: "CORRUPT_ROW", lineNumber: 2 });
  });

  it("refuses a seq JSON cannot carry exactly, rather than restoring its rounded neighbour", () => {
    const unsafe = MEMORY_LINE.replace('"seq":4', '"seq":9007199254740993');
    expect(unsafe).toContain('"seq":9007199254740993');
    const refusal = unwrapErr(decodeRestoreFiles({ file: exportPair({ memories: [unsafe] }) }));
    expect(refusal).toMatchObject({ code: "CORRUPT_ROW", lineNumber: 1 });
  });

  it("refuses a recall seq that is not a positive safe integer", () => {
    const zero = RECALL_LINE.replace('"seq":2', '"seq":0');
    expect(zero).toContain('"seq":0');
    const refusal = unwrapErr(decodeRestoreFiles({ file: exportPair({ memories: [MEMORY_LINE], recalls: [zero] }) }));
    expect(refusal).toMatchObject({ code: "CORRUPT_ROW", lineNumber: 1 });
  });
});
