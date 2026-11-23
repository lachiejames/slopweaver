/**
 * `slopweaver hex output --cell <id>` — the rows a SQL cell last produced, printed to this session and
 * stored nowhere.
 *
 * ## The one line that governs this verb
 *
 * Hex is never ingested into the corpus, but access to it during investigation is massively useful. So this verb imports no store,
 * no corpus writer and no atlas publisher: the rows go to stdout and end there. What makes reading them
 * safe is Hex's own masking and access control — the reason the owner wants data reached this way rather than
 * through a new grant on some other system.
 *
 * ## What the rows ARE
 *
 * The draft notebook session's latest output preview, from the `runId` printed beside them, bounded by
 * Hex's own `rowLimit` before this verb's `--limit` is applied. Not a fresh execution. `slopweaver hex runs
 * --project <id>` is how a reader judges how old the draft's numbers are, and the verb says so whenever the
 * result is truncated.
 *
 * ## `--date-column`, the correlation asked for by name
 *
 * With a date column, the rows are split at Datadog's retention edge: how many Datadog could still
 * corroborate event by event, and how many only Hex can still see. That second number is the answer to
 * "who is affected beyond 15 days", which is the question Datadog is not good for.
 */
import { readCellOutput } from "../../../hex/reads.js";
import type { HexCellOutput, HexTableResult } from "../../../hex/responses.js";
import {
  type BoundedOutput,
  boundOutput,
  type RetentionSplit,
  renderOutputTable,
  retentionSplit,
} from "../../../hex/shape.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexOutputOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_OUTPUT_USAGE } from "./usage.js";

/**
 * Run the `hex output` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexOutput(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["output"] });
  if (askedForHelp({ rest, usage: HEX_OUTPUT_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexOutputOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_OUTPUT_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const read = await readCellOutput({ cellId: options.cellId, client: opened.client });
  if (read.isErr()) {
    return exitForHexError({ error: read.error });
  }
  const output = read.value;
  const result = output.result;
  if (result.type === "cell_run_error") {
    [
      `cell ${output.cell.id} last ran into an error, so it has no rows:`,
      `  ${result.message}`,
      `  from run ${output.runId} — someone has to fix and re-run the notebook; this integration never runs one`,
    ].forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  const bounded = boundOutput({
    limit: options.limit,
    result,
    ...(options.columns.length === 0 ? {} : { columns: options.columns }),
  });
  const split = splitFor({ bounded, dateColumn: options.dateColumn, nowIso: options.nowIso });
  if (options.json) {
    logger.out({
      line: safeJsonStringify({
        label: "hex output",
        value: outputDocument({
          bounded,
          cell: output.cell,
          projectId: output.projectId,
          result,
          runId: output.runId,
          split,
        }),
      }),
    });
    return EXIT_OK;
  }
  outputLines({ bounded, dateColumn: options.dateColumn, result, runId: output.runId, split }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * The retention split this invocation asked for, or `null` when it asked for none.
 *
 * @param dateColumn the column to split on, or `null`
 * @param nowIso the instant to judge against, or `null` to take the wall clock
 * @param bounded the rows the split is computed over — the BOUNDED ones, so the numbers match what printed
 * @returns the split, or `null`
 */
function splitFor({
  dateColumn,
  nowIso,
  bounded,
}: {
  dateColumn: string | null;
  nowIso: string | null;
  bounded: BoundedOutput;
}): RetentionSplit | null {
  if (dateColumn === null) {
    return null;
  }
  return retentionSplit({
    dateColumn,
    nowIso: judgedAt({ nowIso }),
    rows: bounded.rows,
  });
}

/** The instant a retention split is judged against: the `--now` a caller pinned, else the wall clock. */
function judgedAt({ nowIso }: { nowIso: string | null }): string {
  if (nowIso === null) {
    return new Date().toISOString();
  }
  return nowIso;
}

/**
 * The `--json` document, carrying every bound the human rendering states in prose.
 *
 * Its own function so the two renderings cannot drift on WHICH bounds they carry: a caller parsing the JSON
 * has to be able to see the truncation and the retention split exactly as a reader of the table does.
 *
 * @param cell which cell was read
 * @param projectId the project it belongs to
 * @param runId the run the preview came from
 * @param result the table arm Hex returned
 * @param bounded the rows after this verb's own limit and column projection
 * @param split the Datadog-retention split, or `null`
 * @returns the document to serialise
 *
 * @internal
 */
export function outputDocument({
  cell,
  projectId,
  runId,
  result,
  bounded,
  split,
}: {
  cell: HexCellOutput["cell"];
  projectId: string;
  runId: string;
  result: HexTableResult;
  bounded: BoundedOutput;
  split: RetentionSplit | null;
}): Record<string, unknown> {
  return {
    cell,
    columns: bounded.columns,
    missingColumns: bounded.missingColumns,
    omittedRows: bounded.omittedRows,
    projectId,
    retention: split,
    rows: bounded.rows,
    rowsReturned: result.rowsReturned,
    runId,
    totalRows: result.totalRows,
    totalRowsKind: result.totalRowsKind,
    truncated: result.truncated,
  };
}

/**
 * Every line the human rendering prints — the rows, then each bound a reader has to carry into an answer.
 *
 * Pure, and its own function because these lines ARE the honesty contract: a truncated preview quoted as a
 * total, or a retention split printed without its edge, is the wrong answer that reads like the right one.
 *
 * @param result the table arm Hex returned
 * @param runId the run the preview came from, so a reader can date it
 * @param bounded the rows after this verb's own limit and column projection
 * @param split the Datadog-retention split, or `null` when the caller asked for none
 * @param dateColumn the column the split was computed on, echoed so a reader sees which one
 * @returns the lines, in print order
 *
 * @internal
 */
export function outputLines({
  result,
  runId,
  bounded,
  split,
  dateColumn,
}: {
  result: HexTableResult;
  runId: string;
  bounded: BoundedOutput;
  split: RetentionSplit | null;
  dateColumn: string | null;
}): readonly string[] {
  const truncation = result.truncated
    ? [
        `  Hex itself truncated this preview at ${String(result.rowLimit)} row(s) — the cell's real result is larger, and a total of ${result.totalRows === null ? "unknown" : String(result.totalRows)} is ${result.totalRowsKind}`,
      ]
    : [];
  return [
    `${String(result.rowsReturned)} row(s) from run ${runId} of the DRAFT session, not a fresh execution`,
    ...renderOutputTable({ output: bounded }).map((line) => `  ${line}`),
    ...bounded.missingColumns.map((name) => `  (--column "${name}" is not in this result)`),
    ...(bounded.omittedRows === 0
      ? []
      : [`  ${String(bounded.omittedRows)} more row(s) were returned and not printed — raise --limit`]),
    ...truncation,
    ...retentionLines({ dateColumn, split }),
    "nothing above was written to disk — Hex is read, never ingested",
  ];
}

/**
 * The retention split's own lines, or nothing when the caller asked for no split.
 *
 * @param split what the split came to
 * @param dateColumn the column it was judged on
 * @returns the lines
 */
function retentionLines({
  split,
  dateColumn,
}: {
  split: RetentionSplit | null;
  dateColumn: string | null;
}): readonly string[] {
  if (split === null || dateColumn === null) {
    return [];
  }
  return [
    `  retention split on "${dateColumn}" at ${split.edgeIso} (${String(split.retentionDays)}d):`,
    `    ${String(split.inside)} row(s) inside Datadog's window — corroborate event by event there`,
    `    ${String(split.beyond)} row(s) BEYOND it — only Hex still holds these`,
    ...(split.unparseable === 0
      ? []
      : [`    ${String(split.unparseable)} row(s) carried no readable date and are in neither count`]),
  ];
}

export const hexOutputCommand = defineCommand({ run: runHexOutput });
