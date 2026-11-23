/**
 * The pure half of `slopweaver dev slice-shape`: the flag spec, and the rendering of a
 * {@link ../../../corpus/sliceShape.SliceShape} into the table a slice decision is actually read off.
 *
 * The report is arranged as the four candidate shapes rather than as the corpus's internals, because the
 * question it exists to answer is "which of window, cap, sample or channels buys the most speed for the
 * least loss" and a reader should not have to do the arithmetic themselves.
 */

import type { SliceShape } from "../../../corpus/sliceShape.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const DEV_SLICE_SHAPE_USAGE =
  "usage: slopweaver dev slice-shape [--home <dir>] [--corpus <dir>] [--top N] [--json]\n" +
  "  One streaming pass over bronze, emitting the four numbers a dev-loop slice is priced on: a per-month\n" +
  "  record histogram (window), the per-source counts a cap survives (cap), the per-thread size distribution\n" +
  "  (sample), and the per-container tally an allowlist would name (channels). Read-only.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "corpus", "top"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_SLICE_SHAPE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * How many containers are named individually before the tail row, when `--top` is absent.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const DEFAULT_TOP_CONTAINERS = 20;

/**
 * Parse `dev slice-shape` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseDevSliceShapeArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * The container count a `--top` value names.
 *
 * @param value the flag's raw value (`undefined` when absent)
 * @returns the count, defaulted when the flag is absent, or the errors when the value is not a count
 */
export function parseTopContainers({ value }: { value: string | undefined }): Result<number> {
  if (value === undefined) {
    return ok(DEFAULT_TOP_CONTAINERS);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return err([`--top must be a non-negative whole number, got ${value}`]);
  }
  return ok(parsed);
}

/**
 * A byte count as GB/MB/KB, at one decimal — the unit a corpus reading is discussed in.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 *
 * @returns the count as GB, MB, KB or plain bytes
 */
export function humanBytes({ bytes }: { bytes: number }): string {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  if (bytes >= 1e6) {
    return `${(bytes / 1e6).toFixed(1)} MB`;
  }
  if (bytes >= 1e3) {
    return `${(bytes / 1e3).toFixed(1)} KB`;
  }
  return `${String(bytes)} B`;
}

/**
 * A share as a percentage at one decimal.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 *
 * @returns the share as a percentage string
 */
export function percent({ share }: { share: number }): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * A count with thousands separators, so a seven-digit number is readable at a glance.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 *
 * @returns the value, rounded, with thousands separators
 */
export function count({ value }: { value: number }): string {
  return Math.round(value).toLocaleString("en-US");
}

/** One end of the dated span, or a dash when the pass read no dated record to bound it. */
function spanEnd({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "—";
  }
  return iso;
}

/** The header block: what the pass read, and over what span. */
function headerLines({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    `slice-shape: ${count({ value: shape.totalRecords })} records, ${humanBytes({ bytes: shape.totalBytes })} on disk`,
    `  span: ${spanEnd({ iso: shape.oldestIso })} → ${spanEnd({ iso: shape.newestIso })} (${count({ value: shape.undatedRows })} undated rows)`,
    "",
    "by source",
    ...shape.bySource.map(
      (row) =>
        `  ${row.source.padEnd(8)} ${count({ value: row.records }).padStart(11)} rec ${percent({ share: row.recordShare }).padStart(6)}   ` +
        `${humanBytes({ bytes: row.bytes }).padStart(9)} ${percent({ share: row.byteShare }).padStart(6)}`,
    ),
  ];
}

/** The window shape: what each candidate `--days` keeps. */
function windowLines({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    "",
    "SHAPE 1 · window — slopweaver subset build --days N",
    ...shape.windows.map(
      (row) =>
        `  --days ${String(row.days).padStart(3)}  ${count({ value: row.records }).padStart(11)} rec ` +
        `${percent({ share: row.recordShare }).padStart(6)}   ${humanBytes({ bytes: row.bytes }).padStart(9)} ` +
        `${percent({ share: row.byteShare }).padStart(6)}   since ${row.sinceIso.slice(0, 10)}`,
    ),
  ];
}

/** The cap shape: what each candidate per-source `--limit` keeps. */
function capLines({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    "",
    "SHAPE 2 · cap — slopweaver subset build --limit N (newest N per source)",
    ...shape.caps.map((row) => {
      const per = row.bySource.map((entry) => `${entry.source}:${count({ value: entry.kept })}`).join(" ");
      return (
        `  --limit ${count({ value: row.limit }).padStart(7)}  ${count({ value: row.records }).padStart(11)} rec ` +
        `${percent({ share: row.recordShare }).padStart(6)}   ${per}`
      );
    }),
  ];
}

/** The sample shape: the Slack thread size distribution a whole-thread sample would draw from. */
function sampleLines({ shape }: { shape: SliceShape }): readonly string[] {
  const { threads } = shape;
  return [
    "",
    "SHAPE 3 · sample — whole Slack threads, no verb today",
    `  ${count({ value: threads.population })} threads · mean ${threads.meanRecords.toFixed(1)} rec / ` +
      `${humanBytes({ bytes: threads.meanBytes })} · max ${count({ value: threads.maxRecords })} rec / ` +
      `${humanBytes({ bytes: threads.maxBytes })}`,
    `  records per thread  ${threads.recordPercentiles.map((entry) => `p${String(entry.percentile)}=${count({ value: entry.value })}`).join("  ")}`,
    `  bytes per thread    ${threads.bytePercentiles.map((entry) => `p${String(entry.percentile)}=${humanBytes({ bytes: entry.value })}`).join("  ")}`,
  ];
}

/** The channels shape: how concentrated the corpus is, and which containers carry it. */
function channelLines({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    "",
    "SHAPE 4 · channels — a container allowlist, no verb today",
    `  ${count({ value: shape.containerCount })} containers hold every container-scoped record`,
    ...shape.concentration.map(
      (row) =>
        `  ${percent({ share: row.share }).padStart(6)} of records sit in the top ${count({ value: row.containers })} containers`,
    ),
    ...shape.containerCuts.map(
      (row) =>
        `  top ${String(row.containers).padStart(2)}  keep ${count({ value: row.keep.records }).padStart(9)} rec ` +
        `${percent({ share: row.keep.recordShare }).padStart(6)} / ${humanBytes({ bytes: row.keep.bytes }).padStart(9)} ` +
        `${percent({ share: row.keep.byteShare }).padStart(6)}   |   drop → ` +
        `${count({ value: row.drop.records }).padStart(9)} rec ${percent({ share: row.drop.recordShare }).padStart(6)} / ` +
        `${humanBytes({ bytes: row.drop.bytes }).padStart(9)} ${percent({ share: row.drop.byteShare }).padStart(6)}`,
    ),
    ...shape.topContainers.map(
      (row) =>
        `  ${row.key.padEnd(28)} ${count({ value: row.records }).padStart(9)} rec ${percent({ share: row.recordShare }).padStart(6)}   ` +
        `${humanBytes({ bytes: row.bytes }).padStart(9)} ${percent({ share: row.byteShare }).padStart(6)}`,
    ),
    `  ${"…the rest".padEnd(28)} ${count({ value: shape.containerTail.records }).padStart(9)} rec ` +
      `${percent({ share: shape.containerTail.recordShare }).padStart(6)}   ` +
      `${humanBytes({ bytes: shape.containerTail.bytes }).padStart(9)} ${percent({ share: shape.containerTail.byteShare }).padStart(6)}`,
  ];
}

/** The month histogram, oldest first — the raw material behind the window pricing. */
function monthLines({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    "",
    "month histogram (all sources)",
    ...shape.byMonth.map(
      (row) =>
        `  ${row.key}  ${count({ value: row.records }).padStart(9)} rec ${percent({ share: row.recordShare }).padStart(6)}   ` +
        `${humanBytes({ bytes: row.bytes }).padStart(9)}`,
    ),
  ];
}

/**
 * Render the whole report.
 *
 * @param shape the finished reading
 * @returns the lines, in the order a reader prices the four shapes in
 */
export function renderSliceShape({ shape }: { shape: SliceShape }): readonly string[] {
  return [
    ...headerLines({ shape }),
    ...windowLines({ shape }),
    ...capLines({ shape }),
    ...sampleLines({ shape }),
    ...channelLines({ shape }),
    ...monthLines({ shape }),
  ];
}
