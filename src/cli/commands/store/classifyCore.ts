/**
 * The pure half of `slopweaver store classify`: its flags, its parser and the report it prints. The run is
 * `./classify.ts`'s; the pass is `../../../store/resolveDataClasses.ts`'s.
 *
 * **The default report is counts and declared names only.** Table, class, outcome and rule names, register and
 * home-path declaration names, and numbers: never a row id, body, title, container, author or source value. Row ids
 * appear only under `--sample`, which exists for the owner's own visible check of the most private classes and is
 * never copied onto a page, message or pull request.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { DATA_CLASSES } from "../../../store/dataClass.js";
import type { StoreError } from "../../../store/errors.js";
import type { DataClassificationReport, DataClassTableReport } from "../../../store/resolveDataClasses.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** The one usage line, shared with the manifest entry that describes this verb. */
export const CLASSIFY_USAGE =
  "usage: slopweaver store classify [--dry-run] [--sample <1..100>] [--batch <1..30000>] [--home <dir>] [--json]";

/** The flags `store classify` advertises, for the help-truth ratchet. */
export const STORE_CLASSIFY_FLAG_NAMES: readonly string[] = ["--batch", "--dry-run", "--home", "--json", "--sample"];

/** What `store classify` accepts. */
const CLASSIFY_FLAGS: FlagSpec = { boolean: ["dry-run", "json"], string: ["batch", "home", "sample"] };

/** The largest page a caller may ask for: two bound parameters a row stays inside Postgres's 65,535. */
const MAX_CLASSIFY_BATCH_ROWS = 30_000;

/** The bounds a numeric flag must sit inside. */
const BOUNDS: Readonly<Record<"batch" | "sample", { readonly max: number }>> = {
  batch: { max: MAX_CLASSIFY_BATCH_ROWS },
  sample: { max: 100 },
};

/** A parsed `store classify` invocation. */
export interface StoreClassifyArgs {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly batch?: number;
  readonly sample?: number;
  readonly home?: string;
}

/**
 * Read one bounded whole-number flag.
 *
 * @param flag the flag's name, without dashes
 * @param raw what the invocation passed, or undefined when absent
 * @returns the number, undefined when absent, or why it is refused
 */
function boundedFlag({
  flag,
  raw,
}: {
  flag: "batch" | "sample";
  raw: unknown;
}): Result<number | undefined, StoreCommandError> {
  if (typeof raw !== "string") {
    return ok(undefined);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return err(StoreCommandErrors.batchInvalid({ flag, got: raw, usage: CLASSIFY_USAGE }));
  }
  if (value > BOUNDS[flag].max) {
    return err(
      StoreCommandErrors.flagsInvalid({
        reasons: [`--${flag} is at most ${String(BOUNDS[flag].max)}, not ${raw}`, CLASSIFY_USAGE],
      }),
    );
  }
  return ok(value);
}

/**
 * Parse a classify invocation. Each absent flag is OMITTED rather than set to `undefined`, which
 * `exactOptionalPropertyTypes` makes a different thing from a supplied one.
 *
 * @param rest the flag tail
 * @returns what the pass should do, or why the invocation was refused
 */
export function parseStoreClassifyArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreClassifyArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: CLASSIFY_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const batch = boundedFlag({ flag: "batch", raw: values["batch"] });
  if (batch.isErr()) {
    return err(batch.error);
  }
  const sample = boundedFlag({ flag: "sample", raw: values["sample"] });
  if (sample.isErr()) {
    return err(sample.error);
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    json: values["json"] === true,
    ...(batch.value === undefined ? {} : { batch: batch.value }),
    ...(sample.value === undefined ? {} : { sample: sample.value }),
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * One classified table as a line: rows scanned and written, then every class count, then rows still holding none.
 *
 * @param table the table's report
 * @returns the line
 */
function tableLine({ table }: { table: DataClassTableReport }): string {
  const classes = DATA_CLASSES.map((one) => `${one} ${String(table.classes[one])}`).join(", ");
  return (
    `  ${table.table.padEnd(14)} scanned ${String(table.scanned)}, differing ${String(table.differing)}, ` +
    `written ${String(table.written)}; ${classes}; no class ${String(table.nulls)}`
  );
}

/**
 * The rule an outcome came from, as the report names it.
 *
 * @param ruleId the deciding rule's id, or null when no rule decided
 * @returns the id, or `(no rule)`
 */
function ruleLabel({ ruleId }: { ruleId: string | null }): string {
  if (ruleId === null) {
    return "(no rule)";
  }
  return ruleId;
}

/**
 * The report as the lines a person reads.
 *
 * @param report what the pass did
 * @returns each line, ready to write
 */
export function classifyLines({ report }: { report: DataClassificationReport }): readonly string[] {
  const scanned = report.tables.reduce((sum, table) => sum + table.scanned, 0);
  const written = report.tables.reduce((sum, table) => sum + table.written, 0);
  const stillNull = report.tables.reduce((sum, table) => sum + table.nulls, 0);
  const mode = report.dryRun ? "dry run, nothing written; counts are what an apply would store" : "applied";
  const lines = [
    `store classify (${mode}): ${String(scanned)} row(s) across ${String(report.tables.length)} classified ` +
      `table(s), ${String(written)} written`,
    ...report.tables.map((table) => tableLine({ table })),
    "  by rule:",
    ...report.tables.flatMap((table) =>
      table.outcomes.map(
        (outcome) =>
          `    ${table.table} ${ruleLabel({ ruleId: outcome.ruleId })} ${outcome.kind} → ` +
          `${outcome.dataClass} ${String(outcome.rows)}`,
      ),
    ),
  ];
  const counted = report.unclassifiedTables.flatMap((table) =>
    table.rows === null ? [] : [{ rows: table.rows, table: table.table }],
  );
  const absent = report.unclassifiedTables.filter((table) => table.rows === null).map((table) => table.table);
  const unclassifiedRows = counted.reduce((sum, table) => sum + table.rows, 0);
  lines.push(
    `  no class column, every row fails closed as unknown: ${String(report.unclassifiedTables.length)} table(s), ` +
      `${String(unclassifiedRows)} row(s); ` +
      counted.map((table) => `${table.table}=${String(table.rows)}`).join(", "),
  );
  if (absent.length > 0) {
    lines.push(`  not in this store: ${absent.join(", ")}`);
  }
  lines.push(
    `  places, never read and never classified, fail closed: ${String(report.places.length)}; ` +
      report.places.join(", "),
  );
  for (const sample of report.samples) {
    lines.push(
      `  sample ${sample.dataClass} (owner only, never copied out): ` +
        (sample.refs.length === 0 ? "none" : sample.refs.map((ref) => `${ref.table}/${ref.id}`).join(", ")),
    );
  }
  if (!report.dryRun && stillNull > 0) {
    lines.push(
      `  NOT COMPLETE: ${String(stillNull)} row(s) still hold no class — a write landed during the pass; run it again`,
    );
  }
  return lines;
}

/**
 * Whether an applying pass left a classified row with no class at all.
 *
 * @param report what the pass did
 * @returns true when an applying pass left a `NULL` standing
 */
export function classifyIncomplete({ report }: { report: DataClassificationReport }): boolean {
  return !report.dryRun && report.tables.some((table) => table.nulls > 0);
}

/**
 * The SQLSTATE a database error carries, walked down to the driver's own error under any wrapper.
 *
 * @param cause whatever the pass threw
 * @returns the five-character code, or undefined when the error carries none
 */
function sqlStateOf({ cause }: { cause: unknown }): string | undefined {
  let deepest: unknown = cause;
  while (deepest instanceof Error && deepest.cause !== undefined && deepest.cause !== null) {
    deepest = deepest.cause;
  }
  if (deepest instanceof Error && "code" in deepest && typeof deepest.code === "string") {
    return /^[0-9A-Z]{5}$/.test(deepest.code) ? deepest.code : undefined;
  }
  return undefined;
}

/**
 * The one line a failed pass prints, which never carries the database's own text.
 *
 * A database refusal's first line can quote a stored value — an invalid key, a constraint's `DETAIL`, a trigger
 * raising a column — and this verb's output is counts only, so a failure the DATABASE raised prints its SQLSTATE
 * and nothing it said. A failure this pass raised itself (a census or decode refusal, a string cause) names only
 * table and class names and counts, so it prints whole.
 *
 * @param error the pass's typed failure
 * @returns the line to print
 */
export function classifyFailureLine({ error }: { error: StoreError }): string {
  if (error.code !== "STORE_QUERY_FAILED" || !(error.cause instanceof Error)) {
    return error.message;
  }
  const state = sqlStateOf({ cause: error.cause });
  const named = state === undefined ? "with no SQLSTATE" : `with SQLSTATE ${state}`;
  return `store classify failed: the database refused a statement ${named}; its message is withheld because it can quote a stored value`;
}
