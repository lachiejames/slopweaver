/**
 * The backfill's production wiring, over explicit temp `handovers/` and `runs/` directories. Its defining
 * rule is "manifest once, state fresh": every re-read acquires the board and journals again and re-attaches
 * the manifest first parsed — even when the manifest file has since changed on disk. The clock seam is not
 * called here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRulingAuditInput } from "../../../handover/rulingAuditStore.js";
import { rulingBackfillDeps } from "../../../handover/rulingBackfillStore.js";

const MANIFEST = {
  entries: [
    {
      anchor: "journal:runs/alpha.jsonl#2026-09-01T00:00:00.000Z",
      slug: "alpha",
      sourceAtIso: "2026-09-01T00:00:00.000Z",
      words: "ship it",
    },
  ],
  schemaVersion: 1,
};

let root = "";
let handoverDir = "";
let runsDir = "";
let manifestPath = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "backfillstore-"));
  handoverDir = join(root, "handovers");
  runsDir = join(root, "runs");
  manifestPath = join(root, "manifest.json");
  mkdirSync(handoverDir);
  mkdirSync(runsDir);
  writeFileSync(manifestPath, JSON.stringify(MANIFEST), "utf8");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("rulingBackfillDeps", () => {
  it("binds the one write path to applyRowEvent itself", () => {
    const input = readRulingAuditInput({ handoverDir, manifestPath, runsDir });

    expect(rulingBackfillDeps({ input }).append).toBe(applyRowEvent);
  });

  it("re-reads the same directories and carries the first-parsed manifest and its path forward", () => {
    const input = readRulingAuditInput({ handoverDir, manifestPath, runsDir });

    const current = rulingBackfillDeps({ input }).readCurrentInput();

    expect(current.handoverDir).toBe(handoverDir);
    expect(current.runsDir).toBe(runsDir);
    expect(current.manifestPath).toBe(manifestPath);
    expect(current.manifest).toBe(input.manifest);
    expect(current.manifest).toEqual(MANIFEST);
    expect(current.problems).toEqual([]);
  });

  it("sees a journal written between two reads, while still carrying the original manifest object", () => {
    const input = readRulingAuditInput({ handoverDir, manifestPath, runsDir });
    const deps = rulingBackfillDeps({ input });

    const before = deps.readCurrentInput();
    writeFileSync(join(runsDir, "beta.jsonl"), "", "utf8");
    writeFileSync(manifestPath, JSON.stringify({ entries: [], schemaVersion: 1 }), "utf8");
    const after = deps.readCurrentInput();

    expect(before.rows.map((row) => row.slug)).toEqual([]);
    expect(after.rows.map((row) => [row.slug, row.journalPath, row.journal.kind])).toEqual([
      ["beta", join(runsDir, "beta.jsonl"), "read"],
    ]);
    expect(after.manifest).toBe(input.manifest);
    expect(after.manifest).toEqual(MANIFEST);
  });
});
