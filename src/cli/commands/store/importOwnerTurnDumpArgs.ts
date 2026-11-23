/**
 * `slopweaver store import-owner-turn-dump`'s arguments, and the lines its report prints. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

/** What the verb was asked to do. */
export interface ImportOwnerTurnDumpArgs {
  /** The dump file. */
  readonly from: string;
  readonly home: string | undefined;
  /** Read and check, write nothing and open no connection. */
  readonly dryRun: boolean;
  readonly json: boolean;
}

/** What one load did, as the report prints it. */
export interface ImportOwnerTurnDumpReport {
  readonly from: string;
  readonly dryRun: boolean;
  /** Rows the dump carried, all checked. */
  readonly bodies: number;
  readonly locations: number;
  /** Rows the store did not already hold; zero on a dry run, and on a re-run over the same dump. */
  readonly bodiesWritten: number;
  readonly locationsWritten: number;
  /** Every refused row's message. Non-empty means nothing was written. */
  readonly refused: readonly string[];
}

/** The flags that take a path as their value. */
const PATH_FLAGS: ReadonlySet<string> = new Set(["--from", "--home"]);

/**
 * Parse the verb's arguments.
 *
 * @param argv the argument list after the verb itself
 * @returns the arguments, or the refusal lines to print — display-only, so the default error list
 */
export function parseImportOwnerTurnDumpArgs({ argv }: { argv: readonly string[] }): Result<ImportOwnerTurnDumpArgs> {
  const problems: string[] = [];
  const paths = new Map<string, string>();
  let dryRun = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--dry-run") {
      dryRun = true;
    } else if (token === "--json") {
      json = true;
    } else if (PATH_FLAGS.has(token)) {
      index += 1;
      takePath({ flag: token, paths, problems, value: argv[index] });
    } else {
      problems.push(`unexpected argument: ${token}`);
    }
  }
  const from = paths.get("--from");
  if (from === undefined && problems.length === 0) {
    problems.push("--from <owner-tables.sql> is required: the dump to load");
  }
  if (problems.length > 0 || from === undefined) {
    return err(problems);
  }
  return ok({ dryRun, from, home: paths.get("--home"), json });
}

/**
 * Record one path flag's value, or the problem of its having none.
 *
 * @param flag the path flag just read
 * @param value the argument after it, absent at the end of the list
 * @param paths every path flag's value so far, mutated
 * @param problems the refusal lines so far, mutated
 */
function takePath({
  flag,
  value,
  paths,
  problems,
}: {
  flag: string;
  value: string | undefined;
  paths: Map<string, string>;
  problems: string[];
}): void {
  if (value === undefined) {
    problems.push(`${flag} needs a path`);
    return;
  }
  paths.set(flag, value);
}

/**
 * The report as the lines a human reads.
 *
 * @param report what the load did
 * @param refusalCap how many refusals to spell before summarising the rest
 * @returns the lines
 */
export function importOwnerTurnDumpLines({
  report,
  refusalCap = 10,
}: {
  report: ImportOwnerTurnDumpReport;
  refusalCap?: number;
}): readonly string[] {
  const lines = [
    `store import-owner-turn-dump: ${report.from} carries ${String(report.bodies)} body(ies) at ` +
      `${String(report.locations)} location(s)`,
  ];
  if (report.refused.length > 0) {
    lines.push(`${String(report.refused.length)} row(s) refused, so nothing was written:`);
    lines.push(...report.refused.slice(0, refusalCap).map((message) => `  ${message}`));
    const hidden = report.refused.length - refusalCap;
    if (hidden > 0) {
      lines.push(`  … and ${String(hidden)} more`);
    }
    return lines;
  }
  if (report.dryRun) {
    lines.push("DRY RUN — every row checked; nothing was written and no connection was opened");
    return lines;
  }
  lines.push(
    `${String(report.bodiesWritten)} body(ies) and ${String(report.locationsWritten)} location(s) were new; ` +
      "everything else the store already held",
  );
  return lines;
}
