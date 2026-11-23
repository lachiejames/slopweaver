/*
 * What the corpus compaction test files share: the record factory, the exact bytes a window file holds, the per-case
 * throwaway home that `useCompactHome()` mints in a `beforeEach` and removes in the `afterEach` it registers, and the
 * writer and reader for github's bronze beneath that home. A filesystem round-trip into one `mkdtempSync` directory,
 * nothing else.
 *
 * The shell tests all go through the real `compactSource`, because the bytes it writes are produced a line at a time
 * rather than composed as one string a pure planner could return, so a test that asserted on a returned string would
 * be asserting on the shape that broke.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import { bronzeCompactFile, bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { serialiseRecord } from "../../../../corpus/recordSerialisation.js";
import type { CorpusRecord } from "../../../../corpus/types.js";

/**
 * One well-formed github record, with whichever fields a case needs changed.
 *
 * @returns the default record with `over` spread on top
 */
export const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "hello",
  tsIso: "2026-06-01T00:00:00.000Z",
  url: "https://example.test/1",
  ...over,
});

/**
 * A window file's content from a list of records (the exact bytes the writer would have appended).
 *
 * @returns one serialised line per record, newline-terminated
 */
export const jsonl = ({ records }: { records: readonly CorpusRecord[] }): string =>
  `${records.map((r) => serialiseRecord({ record: r })).join("\n")}\n`;

/** The case's throwaway state home; a live binding, assigned before each case and read only inside one. */
export let home: string;

/**
 * Register the hooks that give every case its own throwaway home, and remove it after. Call it once, at the top of
 * a test file whose cases read {@link home}.
 */
export function useCompactHome(): void {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-compact-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });
}

/**
 * Write a bronze window file directly, bypassing the writer's dedup — this is how overlap gets on disk.
 *
 * @returns the window file's absolute path
 */
export function writeWindow({ name, records }: { name: string; records: readonly CorpusRecord[] }): string {
  const dir = bronzeSourceDir({ home, source: "github" });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, jsonl({ records }), "utf8");
  return path;
}

/**
 * The canonical file's bytes after a run.
 *
 * @returns github's canonical bronze file, read whole
 */
export const canonical = (): string => readFileSync(bronzeCompactFile({ home, source: "github" }), "utf8");
