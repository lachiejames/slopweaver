/**
 * Rendering a sweep: a human report, and the machine shape a slash command turns into an artifact.
 *
 * Kept out of `render.ts` (which renders FINDINGS) because the two have nothing in common but a file extension:
 * a finding is a defect to fix, a sweep row is an inventory entry to read. Pure — the caller picks the stream.
 *
 * ## What the human report is FOR
 *
 * A pass down a list, index by index, deciding keep/adjust/drop. So the report groups by routing index, leads
 * each row with the name and the description (the field retrieval actually matches on, and therefore the field
 * being triaged), and never truncates the description — a clipped description makes the decision unmakeable,
 * which is the failure mode a tidy fixed-width table walks straight into.
 *
 * ## Why the age is written as `312d mtime` and not `312d`
 *
 * The suffix is not decoration. Two different questions produce the number — see `sweep.ts` — and a column that
 * dropped the label would read as one answer while being a mixture of two.
 */
import { absentAs } from "#lib/absent.js";
import type { MemoryAgeSource, MemorySweep, MemorySweepRow } from "./types.js";

/** The header's per-source tally, in a fixed order so the line reads the same every run. */
const AGE_SOURCES: readonly MemoryAgeSource[] = ["declared", "mtime", "none"];

/** How each age source is named to a human. `none` is stated, never blank — a gap must not read as zero. */
const AGE_SOURCE_LABEL: Readonly<Record<MemoryAgeSource, string>> = {
  declared: "`modified`",
  mtime: "file mtime",
  none: "no date at all",
};

/** One row's age as a labelled string: the number is meaningless without the source that produced it. */
function ageCell({ row }: { row: MemorySweepRow }): string {
  return row.ageDays === null ? "age unknown" : `${String(row.ageDays)}d ${row.ageSource}`;
}

/** The group heading a row sorts under: the index that routes it, or the fact that nothing does. */
function groupOf({ row }: { row: MemorySweepRow }): string {
  return row.routedBy.length === 0 ? "routed by nothing" : `routed by ${row.routedBy.join(" + ")}`;
}

/** The header, including the per-source age tally — so the mixture is visible before a single row is read. */
function headerLines({ sweep }: { sweep: MemorySweep }): readonly string[] {
  const tally = AGE_SOURCES.map(
    (source) => `${String(sweep.rows.filter((row) => row.ageSource === source).length)} by ${AGE_SOURCE_LABEL[source]}`,
  ).join(", ");
  const stale =
    sweep.staleAfterDays === null
      ? "no --stale-after set"
      : `${String(sweep.rows.filter((row) => row.stale).length)} marked ★ at ${String(sweep.staleAfterDays)}+ days, listed first`;
  return [
    `memory sweep: ${String(sweep.rows.length)} memories — age ${tally}; ${stale}`,
    "  ★ = stale · ←N = how many other memories wikilink to it · ⚠ = a `memory check` finding on this file",
    "",
  ];
}

/** One row: its identity line, its description, then anything the checker has to say about the file. */
function rowLines({ row }: { row: MemorySweepRow }): readonly string[] {
  const mark = row.stale ? "★" : " ";
  const type = absentAs({ value: row.declaredType, whenAbsent: "no type" });
  const head = `  ${mark} ${row.name}  [${type}]  ${ageCell({ row })}  ←${String(row.inboundLinks)}  (${row.file})`;
  return [
    head,
    `      ${absentAs({ value: row.description, whenAbsent: "(no description — retrieval has nothing to match on)" })}`,
    ...row.findings.map((finding) => `      ⚠ [${finding.check}] ${finding.message}`),
  ];
}

/**
 * The human report.
 *
 * @param sweep the sweep, rows already in their canonical order
 * @returns the lines to print, grouped by routing index
 */
export function renderMemorySweepHuman({ sweep }: { sweep: MemorySweep }): readonly string[] {
  if (sweep.rootIndexMissing) {
    return ["memory sweep: no MEMORY.md in this directory — it is not a memory corpus, so there is nothing to lay out"];
  }
  if (sweep.rows.length === 0) {
    return ["memory sweep: no memories in this corpus (a MEMORY.md, but no leaves beside it)"];
  }
  const lines = [...headerLines({ sweep })];
  let group: string | null = null;
  for (const row of sweep.rows) {
    const heading = row.stale ? `${groupOf({ row })} — STALE` : groupOf({ row });
    if (heading !== group) {
      group = heading;
      lines.push(`── ${heading}`);
    }
    lines.push(...rowLines({ row }));
  }
  return lines;
}

/**
 * The machine shape, for `--json`.
 *
 * Both timestamps ride on every row, not just the one the age was computed from, so a consumer can never be
 * misled about which question it is looking at — and can re-derive the age from the other source if it wants
 * the other question answered.
 *
 * @param sweep the sweep, rows already in their canonical order
 * @returns pretty-printed JSON, safe to pipe
 */
export function renderMemorySweepJson({ sweep }: { sweep: MemorySweep }): string {
  return JSON.stringify(sweep, null, 2);
}
