/**
 * The bronze committer refuses a path the owner's protect list covers: its dedup walk before it reads, and its append
 * before it writes. Every case runs on a throwaway home with synthetic rows, its registry written into that home and
 * read through the real `ownerProtection`, so the owner's own registry is never consulted.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { bronzeFile, bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import { createBronzeCommitter, writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { type IngestDeps, ingestSources } from "../../../corpus/ingestSource.js";
import { serialiseRecord } from "../../../corpus/recordSerialisation.js";
import { redactRecord } from "../../../corpus/redactRecord.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { advanceWatermark, readWatermark } from "../../../corpus/watermark.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { OwnerProtectionErrors, ownerProtection } from "../../../protectedPaths/ownerEntries.js";
import { type ProtectionMode, renderProtectedPaths } from "../../../protectedPaths/registry.js";
import { stateHomePaths } from "../../../stateHome.js";

const window: ExportWindow = { since: "2024-01-01", until: "2024-01-03" };
const ADDED = "2026-11-01T00:00:00.000Z";

const slackRecord = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "C0FIXTURE",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "1700000000.000100",
  text: "a synthetic message",
  tsIso: "2024-01-02T00:00:00Z",
  url: "https://acme.example/archives/C0FIXTURE/p1700000000000100",
  ...over,
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-protected-writer-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Writes the fixture home's own registry and returns a resolver that reads only it.
 *
 * @param entries the synthetic entries to protect
 * @returns a resolver over the fixture home's registry alone
 */
function protect({
  entries,
}: {
  entries: readonly { path: string; mode: ProtectionMode; why: string }[];
}): OwnerProtectionResolver {
  const registry = { paths: entries.map((entry) => ({ ...entry, addedIso: ADDED })), schemaVersion: 1 as const };
  writeFileSync(stateHomePaths({ home }).protectedPathsJson, renderProtectedPaths({ registry }));
  return () => ownerProtection({ homes: [home] });
}

/**
 * Seeds one stored synthetic row into a file.
 *
 * @param file where the row is written
 * @returns the exact bytes written
 */
function seed({ file }: { file: string }): string {
  mkdirSync(dirname(file), { recursive: true });
  const bytes = `${serialiseRecord({ record: slackRecord({ sourceId: "1600000000.000100", text: "stored" }) })}\n`;
  writeFileSync(file, bytes);
  return bytes;
}

describe("the bronze committer and the owner's protect list", () => {
  it("refuses a no-access source before reading it, leaving its bytes and creating no window file", () => {
    const slackDir = bronzeSourceDir({ home, source: "slack" });
    const stored = join(slackDir, "2023-01-01_2023-01-03.jsonl");
    const bytes = seed({ file: stored });
    const protection = protect({ entries: [{ mode: "no-access", path: slackDir, why: "private\n  channel" }] });

    const result = writeCorpusRecords({ home, protection, records: [slackRecord()], window });

    expect(unwrapErr(result)).toEqual([
      `refusing to write slack: it would search ${slackDir}, which the owner's protect list marks no-access at ` +
        `${slackDir} (private channel)`,
    ]);
    expect(readFileSync(stored, "utf8")).toBe(bytes);
    expect(existsSync(bronzeFile({ home, source: "slack", window }))).toBe(false);
  });

  it("refuses a directory symlink inside an allowed source that leads into a protected tree", () => {
    const slackDir = bronzeSourceDir({ home, source: "slack" });
    const elsewhere = join(home, "elsewhere");
    const bytes = seed({ file: join(elsewhere, "held.jsonl") });
    mkdirSync(slackDir, { recursive: true });
    symlinkSync(elsewhere, join(slackDir, "nested"));
    const protection = protect({ entries: [{ mode: "no-access", path: elsewhere, why: "kept apart" }] });

    const result = writeCorpusRecords({ home, protection, records: [slackRecord()], window });

    expect(unwrapErr(result)).toEqual([
      `refusing to write slack: it would search ${join(slackDir, "nested")}, which the owner's protect list marks ` +
        `no-access at ${realpathSync(elsewhere)} (kept apart)`,
    ]);
    expect(readFileSync(join(elsewhere, "held.jsonl"), "utf8")).toBe(bytes);
    expect(existsSync(bronzeFile({ home, source: "slack", window }))).toBe(false);
  });

  it("refuses to append through a window-file symlink to a read-only target, which it may still read", () => {
    const target = join(home, "kept", "window.jsonl");
    const bytes = seed({ file: target });
    const file = bronzeFile({ home, source: "slack", window });
    mkdirSync(dirname(file), { recursive: true });
    symlinkSync(target, file);
    const protection = protect({ entries: [{ mode: "read-only", path: target, why: "frozen copy" }] });

    const result = writeCorpusRecords({ home, protection, records: [slackRecord()], window });

    expect(unwrapErr(result)).toEqual([
      `refusing to write slack: it would write to ${file}, which the owner's protect list marks read-only at ` +
        `${realpathSync(target)} (frozen copy)`,
    ]);
    expect(readFileSync(target, "utf8")).toBe(bytes);
  });

  it("refuses every write, creating nothing, when the owner's protection cannot be read", () => {
    const protection: OwnerProtectionResolver = () => err(OwnerProtectionErrors.unknown({ reason: "synthetic" }));

    const result = writeCorpusRecords({ home, protection, records: [slackRecord()], window });

    expect(unwrapErr(result)).toEqual([
      "refusing to write slack: the owner's protect list could not be read, so nothing it might cover is touched: " +
        "synthetic",
    ]);
    expect(existsSync(bronzeSourceDir({ home, source: "slack" }))).toBe(false);
  });

  it("refuses a second commit through the same committer, so a refused walk is never held", () => {
    const slackDir = bronzeSourceDir({ home, source: "slack" });
    mkdirSync(slackDir, { recursive: true });
    const protection = protect({ entries: [{ mode: "no-access", path: slackDir, why: "private" }] });
    const committer = createBronzeCommitter({ home, protection, window });
    const refusal =
      `refusing to write slack: it would search ${slackDir}, which the owner's protect list marks no-access at ` +
      `${slackDir} (private)`;

    const first = committer.commit({ records: [slackRecord()] });
    const second = committer.commit({ records: [slackRecord({ sourceId: "1700000000.000200" })] });

    expect(unwrapErr(first)).toEqual([refusal]);
    expect(unwrapErr(second)).toEqual([refusal]);
    expect(existsSync(bronzeFile({ home, source: "slack", window }))).toBe(false);
  });

  it("reads the protect list again for each commit that writes, so a new entry over the source or a broken list refuses the next append", () => {
    const slackDir = bronzeSourceDir({ home, source: "slack" });
    const file = bronzeFile({ home, source: "slack", window });
    const protection = protect({ entries: [] });
    const committer = createBronzeCommitter({ home, protection, window });

    const first = committer.commit({ records: [slackRecord()] });
    const written = readFileSync(file, "utf8");
    protect({ entries: [{ mode: "no-access", path: slackDir, why: "added mid-run" }] });
    const second = committer.commit({ records: [slackRecord({ sourceId: "1700000000.000200" })] });
    writeFileSync(stateHomePaths({ home }).protectedPathsJson, "{ not json");
    const third = committer.commit({ records: [slackRecord({ sourceId: "1700000000.000300" })] });

    expect(unwrap(first)).toEqual({ bySource: { slack: 1 }, deduped: 0, excluded: 0, written: 1 });
    expect(unwrapErr(second)).toEqual([
      `refusing to write slack: it would write to ${file}, which the owner's protect list marks no-access at ` +
        `${slackDir} (added mid-run)`,
    ]);
    expect(unwrapErr(third)[0]).toContain(
      "refusing to write slack: the owner's protect list could not be read, so nothing it might cover is touched:",
    );
    expect(readFileSync(file, "utf8")).toBe(written);
  });

  it("writes and dedups as before when no entry covers the source", () => {
    const protection = protect({ entries: [{ mode: "no-access", path: join(home, "unrelated"), why: "other" }] });
    const committer = createBronzeCommitter({ home, protection, window });

    const first = committer.commit({ records: [slackRecord()] });
    const again = committer.commit({ records: [slackRecord()] });

    expect(unwrap(first)).toEqual({ bySource: { slack: 1 }, deduped: 0, excluded: 0, written: 1 });
    expect(unwrap(again)).toEqual({ bySource: {}, deduped: 1, excluded: 0, written: 0 });
    expect(readFileSync(bronzeFile({ home, source: "slack", window }), "utf8")).toBe(
      `${serialiseRecord({ record: redactRecord({ record: slackRecord() }) })}\n`,
    );
  });
});

describe("a refresh over a protected source", () => {
  it("refuses that source and holds its watermark, while the next source still writes and advances", async () => {
    const slackDir = bronzeSourceDir({ home, source: "slack" });
    mkdirSync(slackDir, { recursive: true });
    const protection = protect({ entries: [{ mode: "no-access", path: slackDir, why: "private" }] });
    const deps: IngestDeps = {
      advance: advanceWatermark,
      nowIso: () => "2030-01-01T00:00:00.000Z",
      write: (args) => writeCorpusRecords({ ...args, protection }),
    };
    const linear: CorpusRecord = {
      container: "ABC",
      kind: "issue",
      refs: [],
      source: "linear",
      sourceId: "ABC-1",
      text: "a synthetic issue",
      tsIso: "2024-01-02T00:00:00.000Z",
      url: "https://linear.example/acme/issue/ABC-1",
    };
    const jobs: readonly SourceIngestJob[] = [
      { label: "slack", run: async () => ok({ records: [slackRecord()], warnings: [] }), source: "slack", window },
      { label: "linear", run: async () => ok({ records: [linear], warnings: [] }), source: "linear", window },
    ];

    const results = unwrap(await ingestSources({ deps, home, jobs }));

    expect(results.map(({ source, ok: passed, written, errors }) => ({ errors, passed, source, written }))).toEqual([
      {
        errors: [
          `refusing to write slack: it would search ${slackDir}, which the owner's protect list marks no-access at ` +
            `${slackDir} (private)`,
        ],
        passed: false,
        source: "slack",
        written: 0,
      },
      { errors: [], passed: true, source: "linear", written: 1 },
    ]);
    expect(readWatermark({ home, source: "slack" })).toBeUndefined();
    expect(readWatermark({ home, source: "linear" })).toBe("2024-01-02T00:00:00.000Z");
  });
});
