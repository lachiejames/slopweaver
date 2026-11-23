/**
 * Where a bronze write lands and the one disk write it makes: records grouped into their source's bucket,
 * then serialised lines appended to that source's window file, its directory created first.
 *
 * A write the disk refuses (full, or a file where the source's directory belongs) comes back as this call's
 * `Err`, never a throw past it: a committer's caller names a failed commit as a coverage gap, and a throw
 * names nothing.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { type CorpusRecord, type CorpusSource } from "./types.js";

/**
 * Group records into their per-source buckets, in {@link BRONZE_SOURCES} order (so the write order is
 * stable) and omitting empty sources. Pure.
 *
 * The iteration list matters: a record whose source is not in it is DROPPED, with no warning and no error —
 * the write reports `written: 0, deduped: N` and exits clean. This iterated the FETCH list, so the first
 * `self` records ever projected vanished at the door with a green run to show for it.
 *
 * @param records the redacted records
 * @returns a source → records map (only sources with records)
 */
export function bucketRecordsBySource({
  records,
}: {
  records: readonly CorpusRecord[];
}): Map<CorpusSource, CorpusRecord[]> {
  const buckets = new Map<CorpusSource, CorpusRecord[]>();
  for (const source of BRONZE_SOURCES) {
    const bucket = records.filter((record) => record.source === source);
    if (bucket.length > 0) {
      buckets.set(source, bucket);
    }
  }
  return buckets;
}

/**
 * Append lines to a bronze window file, each terminated by a newline.
 *
 * @param file the window file, its directory created when absent
 * @param lines serialised records, one per line, none carrying a newline of its own
 * @returns nothing on success, or the one line saying which write failed and why
 */
export function appendBronzeLines({ file, lines }: { file: string; lines: readonly string[] }): Result<void> {
  const wrote = safeFs({
    execute: () => {
      mkdirSync(dirname(file), { recursive: true });
      appendLines({ path: file, text: `${lines.join("\n")}\n` });
    },
    operation: "bronze.append",
    path: file,
  });
  if (wrote.isErr()) {
    return err([`bronze append to ${file} failed: ${wrote.error.message}`]);
  }
  return ok(undefined);
}
