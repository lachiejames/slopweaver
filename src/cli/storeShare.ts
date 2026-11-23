/**
 * How `slopweaver store share` prints — the human table of what each record kind still holds under
 * `~/.slopweaver` against the store table it mirrors into.
 *
 * Separate from `commands/store/shareRun.ts` for the reason `./catalogHealth.ts` beside it already
 * establishes: a renderer is where a figure's LABEL lives, and a label that lies is exactly the failure a
 * share table can produce — "0 MiB" printed for a register nobody walked reads as migrated. Every function
 * here is pure over the folded report, and the printing is the caller's, so a test can read the table
 * without a mock (`untested-modules` refuses a module no test imports, and a void renderer offers one
 * nothing to assert on).
 */
import type { DataClassCensus } from "../store/dataClassCensus.js";
import type { HomeShareReport, RegisterShare } from "../store/homeShare.js";

/** Bytes per mebibyte, for the human column. */
const MIB = 1024 * 1024;

/**
 * Render one register's size cell.
 *
 * @param register the measured row
 * @returns the cell text — a size, or the word that says none was taken
 */
function sizeCell({ register }: { register: RegisterShare }): string {
  if (register.homeBytes === undefined) {
    return "not measured";
  }
  if (!register.present) {
    return "absent";
  }
  return `${(register.homeBytes / MIB).toFixed(1)} MiB / ${String(register.homeRecords)} rec`;
}

/**
 * Render one register's store cell.
 *
 * @param register the measured row
 * @returns the cell text — a row count, the reason nothing mirrors it, why the store could not be read, or that the
 *   store holds no such table
 */
function storeCell({ register }: { register: RegisterShare }): string {
  if (register.table === undefined) {
    return "— unmirrored";
  }
  if (register.storeRows === undefined && register.storeUnreadBecause !== undefined) {
    return `${register.table} (unread: ${register.storeUnreadBecause})`;
  }
  if (register.storeRows === undefined) {
    return `${register.table} (no such table in the store)`;
  }
  return `${register.table} ${String(register.storeRows)} rows`;
}

/**
 * The data-class census as two summary lines, plus one naming any table the census does not declare.
 *
 * Counts only, with the row-classified tables named: every other entry is unclassified, and its reason is in
 * `--json`, so the human view says what holds a class and how much does not.
 *
 * @param census the report's census
 * @returns the lines, ready to write
 */
function dataClassLines({ census }: { census: DataClassCensus }): readonly string[] {
  const classified = census.tables.filter((row) => row.entry?.kind === "row-classified").map((row) => row.name);
  const unclassifiedTables = census.tables.filter((row) => row.entry?.kind === "unclassified").length;
  const lines = [
    `  data classes: ${String(classified.length)} table(s) classify each row (${classified.join(", ")}); ` +
      `${String(unclassifiedTables)} table(s), ${String(census.registers.length)} register(s) and ` +
      `${String(census.homePaths.length)} home path(s) are unclassified\n` +
      "  unclassified fails closed: a consumer treats it as restricted; reasons: slopweaver store share --json",
  ];
  if (census.undeclaredTables.length > 0) {
    lines.push(`  NO DATA-CLASS DECLARATION: ${census.undeclaredTables.join(", ")}`);
  }
  return lines;
}

/**
 * The report as the lines a human reads, in print order.
 *
 * @param report what the measurement found
 * @returns each line, ready to write
 */
export function homeShareLines({ report }: { report: HomeShareReport }): readonly string[] {
  const durable = report.durableMirrored + report.durableUnmirrored;
  const lines: string[] = [
    `store share: ${String(report.durableMirrored)}/${String(durable)} durable registers mirrored into the ` +
      `store; ${String(report.durableUnmirrored)} are not, holding ` +
      `${(report.durableUnmirroredBytes / MIB).toFixed(1)} MiB\n` +
      `  recompute: slopweaver store share --json`,
  ];
  for (const register of report.registers) {
    lines.push(`  ${register.kind.padEnd(21)} ${sizeCell({ register }).padEnd(26)} ${storeCell({ register })}`);
  }
  for (const register of report.registers.filter((one) => one.unmirroredBecause !== undefined)) {
    lines.push(`  ${register.kind}: ${String(register.unmirroredBecause)}`);
  }
  lines.push(
    `  scratch (declared, never walked): ${report.scratchRegisters.join(", ")}\n` +
      `  residue: ${String(report.residue.unclassified)} of ${String(report.residue.topLevelEntries)} ` +
      `top-level entries are claimed by no register — e.g. ${report.residue.sample.join(", ")}`,
  );
  lines.push(...dataClassLines({ census: report.dataClassCensus }));
  if (report.unclassifiedTables.length > 0) {
    lines.push(`  UNCLASSIFIED TABLES: ${report.unclassifiedTables.join(", ")}`);
  }
  return lines;
}
