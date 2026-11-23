/*
 * How rows TALLY: one line at a time into a per-group accumulator, and the conservation arithmetic a read
 * reports afterwards.
 *
 * Every counted quantity a corpus read prints is computed here, and nothing here touches the filesystem.
 * The streaming build reports the same arithmetic over the same shapes, which is why {@link groupOfFile}
 * and {@link tallySkips} are exported rather than private to the read that first needed them.
 */

import { relative, sep } from "node:path";

import { type CorpusProjection, parseRow, SKIP_REASONS, type SkipReason } from "./corpusRowCore.js";
import { type RowWarning } from "./rowWarnings.js";
import { type CorpusRecord } from "./types.js";

/** One skip class and how many rows it claimed — the `records_skipped_with_reason` half of the conservation law. */
export interface SkipTally {
  readonly reason: SkipReason;
  readonly count: number;
}

/**
 * What one group of corpus files contributed, in the terms the conservation law is stated in.
 *
 * `unreadable` is deliberately NOT a skip class: an unreadable file contributes an unknown number of rows, so
 * folding it into the skip tally would make `rows = indexed + skipped` false. It is the failure signal, kept
 * apart from the arithmetic it would otherwise break.
 */
export interface CorpusGroupTally {
  /** The first path segment under the corpus root — the bronze source dir, or `(root)` for a flat corpus. */
  readonly group: string;
  /** Non-blank JSONL lines seen across this group's readable files. */
  readonly rows: number;
  readonly records: readonly CorpusRecord[];
  readonly skipped: readonly SkipTally[];
  /** Files (and directories) in this group that could not be read AT ALL. */
  readonly unreadable: readonly string[];
}

/**
 * The group a file belongs to: its first path segment under the corpus root, or `(root)` when it has none.
 *
 * Exported because the STREAMING lexical build tallies the same groups without going through
 * {@link readCorpusTally} — two implementations of "which leg is this file" is how two readers of one
 * corpus start disagreeing about what it contains. Pure.
 *
 * @param root the corpus root the path is relative to
 * @param file the file (or directory) whose group is wanted
 * @returns the group name
 */
export function groupOfFile({ root, file }: { root: string; file: string }): string {
  const segments = relative(root, file).split(sep);
  const first = segments[0];
  return segments.length > 1 && first !== undefined && first.length > 0 ? first : "(root)";
}

/**
 * Group per-row skip reasons into counted tallies, in {@link SKIP_REASONS} order so the output is stable.
 * Exported for the same reason {@link groupOfFile} is: the streaming build reports the same conservation
 * arithmetic. Pure.
 *
 * @param reasons one entry per skipped row, in read order
 * @returns one tally per reason that actually occurred
 */
export function tallySkips({ reasons }: { reasons: readonly SkipReason[] }): readonly SkipTally[] {
  const counts = new Map<SkipReason, number>();
  for (const reason of reasons) {
    const seen = counts.get(reason);
    counts.set(reason, seen === undefined ? 1 : seen + 1);
  }
  return SKIP_REASONS.flatMap((reason) => {
    const count = counts.get(reason);
    return count === undefined ? [] : [{ count, reason }];
  });
}

/** The mutable accumulator one group fills while its files are read. */
export interface GroupAccumulator {
  rows: number;
  readonly records: CorpusRecord[];
  readonly reasons: SkipReason[];
  readonly unreadable: string[];
}

/**
 * Fetch (or create) the accumulator for a group.
 *
 * @returns the group's accumulator, freshly inserted into `groups` when this is its first file
 */
export function accumulatorFor({
  groups,
  group,
}: {
  groups: Map<string, GroupAccumulator>;
  group: string;
}): GroupAccumulator {
  const existing = groups.get(group);
  if (existing !== undefined) {
    return existing;
  }
  const created: GroupAccumulator = { reasons: [], records: [], rows: 0, unreadable: [] };
  groups.set(group, created);
  return created;
}

/** Tally one line into an accumulator: a record, or a counted skip class with its line-numbered warning. */
export function tallyLine({
  line,
  index,
  into,
  warnings,
  projection,
}: {
  line: string;
  index: number;
  into: GroupAccumulator;
  warnings: RowWarning[];
  projection: CorpusProjection;
}): void {
  if (line.trim().length === 0) {
    return;
  }
  into.rows += 1;
  const result = parseRow({ line, projection });
  if ("record" in result) {
    into.records.push(result.record);
  } else {
    into.reasons.push(result.reason);
    warnings.push({ error: result.error, line: index + 1 });
  }
}

/**
 * Parse one file's content into records + per-row skip reasons, counting every non-blank line. Pure.
 *
 * @returns every non-blank line counted, the records that survived, one skip reason per rejected row,
 *   and a line-numbered warning for each
 */
export function countRows({ content, projection = "bronze" }: { content: string; projection?: CorpusProjection }): {
  total: number;
  records: readonly CorpusRecord[];
  reasons: readonly SkipReason[];
  warnings: readonly string[];
} {
  const into: GroupAccumulator = { reasons: [], records: [], rows: 0, unreadable: [] };
  const warnings: RowWarning[] = [];
  content.split("\n").forEach((line, index) => {
    tallyLine({ index, into, line, projection, warnings });
  });
  // Per ROW here, deliberately unlike {@link readFileInto}: this feeds `parseCorpusRecords`, whose callers
  // hand it one small in-memory document rather than a corpus-scale file, and whose contract is a warning
  // per bad line. The collapse exists for the read path, where one file can carry hundreds.
  return {
    reasons: into.reasons,
    records: into.records,
    total: into.rows,
    warnings: warnings.map((w) => `line ${String(w.line)}: ${w.error}`),
  };
}
